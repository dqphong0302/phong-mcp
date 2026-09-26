/**
 * Academic search orchestrator.
 * Handles parallel search across multiple source plugins,
 * error isolation, RRF ranking, and post-merge filtering.
 *
 * Decoupled from MCP tool registration — easy to unit test independently.
 */

import { SOURCES, filterAvailableSources, resolveSources, getKeyForSource } from "./sources/registry.js";
import { deduplicateAndRank, formatResults, enrichPaperMetrics } from "./formatter.js";
import { satisfiesMinQuartile } from "./quartile.js";
import { calculateAcademicConsensus, isEvaluativeQuery } from "./consensus.js";
import { tokenizeQuery, relevanceScore } from "./sources/_relevance.js";
import { cacheKey, cachedOrExecute, TTL } from "./cache.js";
import { sourceRateLimiter, CircuitBreakerOpenError } from "./rate-limiter.js";
import * as semanticScholar from "./sources/semantic-scholar.js";
import * as openalex from "./sources/openalex.js";
import * as arxiv from "./sources/arxiv.js";
import * as pubmed from "./sources/pubmed.js";
import * as crossref from "./sources/crossref.js";

// ── Search orchestration ──────────────────────────────────────────────────────

/**
 * Run parallel search across multiple sources, deduplicate, and rank results.
 *
 * @param {string} query
 * @param {string[]|string} sources  - source IDs or preset name
 * @param {Object} opts              - search options (limit, year_min, etc.)
 * @param {Object} config            - academic config from config.js
 * @returns {Promise<{ resultStr: string, papers: AcademicPaper[], skipped: Array }>}
 */
// Max papers to enrich (only papers without pdf_url AND without arxiv_id)
const PDF_ENRICH_LIMIT = 10;
// Hard timeout for entire enrichment phase (ms) — was 5000, raised to 8s for realistic OA coverage
const PDF_ENRICH_TIMEOUT_MS = 8000;
// Landing-page metadata enrichment (abstract / DOI for listing-scraped sources)
/** Minimum query coverage for a paper to be ranked by citations rather than demoted. */
const CITATION_SORT_RELEVANCE_FLOOR = 0.45;

const METADATA_ENRICH_LIMIT = 8;
const METADATA_ENRICH_TIMEOUT_MS = 7000;

// ── Fan-out budgets ───────────────────────────────────────────────────────────
/** Workers pulling sources off the queue. Each source is a different host. */
const MAX_CONCURRENT_SOURCES = 12;
/** One-time offset between worker start-ups, so they don't all fire in one tick. */
const STAGGER_INTERVAL_MS = 60;
/** Wall-clock cap on the whole fan-out; whatever has not started by then is skipped. */
const SEARCH_BUDGET_MS = 45000;
/** Default per-source budget. */
const SOURCE_TIMEOUT_MS = 12000;
/**
 * Sources that are simply slow rather than broken. Measured end-to-end at
 * limit=5: the INASP "Journals Online" family and the Vietnamese OJS portals
 * run 12–20s, and OSTI / INSPIRE / Zenodo / ChEMBL run 10–15s. Under the flat
 * 8s cap every one of them was aborted on every single search, which is why the
 * `vietnam` preset came back with almost no Vietnamese results.
 */
const SLOW_SOURCE_TIMEOUT_MS = 22000;
const SLOW_SOURCES = new Set([
  "vjol", "vast", "jst_hust", "vnu_js", "tapchi_yhoc_tphcm", "tapchi_nghiencuuyhoc",
  "medpharmres", "oatd",
  "banglajol", "lamjol", "mongoliajol", "nepjol", "philjol", "sljol", "thaijo", "ajol",
  "zenodo", "osti", "inspire_hep", "chembl", "scielo",
]);

/** Per-source time budget: the plugin may declare its own, else the table above. */
function sourceTimeoutFor(sourceId) {
  const declared = SOURCES.get(sourceId)?.timeoutMs;
  if (Number.isFinite(declared) && declared > 0) return declared;
  return SLOW_SOURCES.has(sourceId) ? SLOW_SOURCE_TIMEOUT_MS : SOURCE_TIMEOUT_MS;
}

export async function runParallelSearch(query, sources, opts = {}, config = {}) {
  const {
    limit = 10,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
    arxiv_categories,
    min_citations,
    venue_filter,
    field_of_study,
    min_quartile,            // Q1, Q2, Q3, Q4
    enrich_pdf = true,       // auto-enrich PDF URLs after search
    enrich_metadata = true,  // fill missing abstract/DOI from landing pages
  } = opts;

  const srcParam = (typeof sources === "string" || Array.isArray(sources)) ? sources : (opts.sources || "default");
  
  const ck = cacheKey("search", {
    query,
    sources: srcParam,
    limit,
    year_min,
    year_max,
    open_access_only,
    sort,
    min_citations,
    venue_filter,
    field_of_study,
    min_quartile,
    arxiv_categories,
    enrich_pdf,
    enrich_metadata,
  });

  const { data, fromCache } = await cachedOrExecute(ck, TTL.SEARCH, async () => {
    return _doRunParallelSearch(query, srcParam, opts, config);
  });

  return { ...data, fromCache: Boolean(fromCache) };
}

async function _doRunParallelSearch(query, srcParam, opts = {}, config = {}) {
  const {
    limit = 10,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
    arxiv_categories,
    min_citations,
    venue_filter,
    field_of_study,
    min_quartile,
    include_consensus = false,
    enrich_pdf = true,
    enrich_metadata = true,
  } = opts;


  const sourceIds = resolveSources(srcParam);
  const { available, skipped } = filterAvailableSources(sourceIds, config);

  if (skipped.length > 0) {
    skipped.forEach(({ id, reason }) => console.warn(`[academic] ${id}: skipping — ${reason}`));
  }

  if (available.length === 0) {
    return { resultStr: "No sources available. Check API key configuration.", papers: [], skipped };
  }

  const searchOpts = { limit, year_min, year_max, open_access_only, sort };
  if (arxiv_categories) searchOpts.categories = arxiv_categories;

  const totals = [];
  const deadline = Date.now() + SEARCH_BUDGET_MS;

  // Run one source: rate-limited, abortable, and capped by both its own budget
  // and whatever is left of the whole fan-out budget. Never rejects.
  async function executeSourceWithSafety(sourceId) {
    const plugin = SOURCES.get(sourceId);
    if (!plugin?.search) return [];

    const budget = Math.min(sourceTimeoutFor(sourceId), deadline - Date.now());
    if (budget <= 0) {
      skipped.push({ id: sourceId, reason: `search budget of ${SEARCH_BUDGET_MS}ms exhausted` });
      return [];
    }

    const ac = new AbortController();
    const sourceOptsWithSignal = { ...searchOpts, signal: ac.signal };

    const sourceTask = sourceRateLimiter.schedule(sourceId, () => {
      return plugin.search(query, sourceOptsWithSignal, config);
    }, ac.signal)
      .then((r) => {
        totals.push(r?.total ?? 0);
        if (r?.unavailable) {
          skipped.push({ id: sourceId, reason: r.reason || "upstream unavailable" });
        }
        return r?.papers || [];
      })
      .catch((e) => {
        if (e instanceof CircuitBreakerOpenError) {
          console.warn(`[academic] ${sourceId}: circuit breaker OPEN — skipping source`);
        } else if (e.name !== "AbortError") {
          console.error(`[academic] ${sourceId} error:`, e.message);
        }
        return [];
      });

    let timer;
    return Promise.race([
      sourceTask.then((res) => {
        if (timer) clearTimeout(timer);
        return res;
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[academic] ${sourceId} timed out after ${budget}ms — aborting`);
          skipped.push({ id: sourceId, reason: `timed out after ${budget}ms` });
          ac.abort();
          resolve([]);
        }, budget);
      }),
    ]);
  }

  // Fixed pool of workers pulling from a shared cursor.
  //
  // The previous dispatcher slept `STAGGER_INTERVAL_MS` *between* sources on the
  // main loop, so the sleeps were serial: 81 sources cost ~6s of pure waiting
  // before the last one even started, on top of a pool of only 6. An exhaustive
  // search took 87s — past the tool timeout of most MCP clients. Different
  // sources are different hosts, and same-host pacing is already the rate
  // limiter's job, so the stagger only needs to keep the workers from firing in
  // one tick at start-up.
  const allSourceResults = new Array(available.length);
  let cursor = 0;

  async function poolWorker(slot) {
    if (slot > 0) await new Promise((r) => setTimeout(r, slot * STAGGER_INTERVAL_MS));
    for (;;) {
      const i = cursor++;
      if (i >= available.length) return;
      allSourceResults[i] = await executeSourceWithSafety(available[i]);
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_SOURCES, available.length);
  await Promise.all(Array.from({ length: workerCount }, (_, slot) => poolWorker(slot)));
  for (let i = 0; i < allSourceResults.length; i++) {
    if (!allSourceResults[i]) allSourceResults[i] = [];
  }
  let merged = deduplicateAndRank(allSourceResults);

  // Sort override for citations mode.
  //
  // Sorting the whole pool by citation count alone answers the wrong question:
  // a loosely-matched blockbuster outranks the paper the user asked for. (A
  // search for ICU sepsis prediction surfaced the ACC/AHA aortic-disease
  // guideline at #3 purely on its 1,993 citations.) So rank by citations
  // *within* the papers that actually match the query, and keep the weak
  // matches behind them rather than dropping them.
  if (sort === "citations") {
    const terms = tokenizeQuery(query);
    const scoreOf = (p) =>
      Math.max(
        relevanceScore(p.title || "", terms, query),
        relevanceScore(`${p.title || ""} ${p.abstract || ""}`, terms, query) * 0.9
      );
    const byCitations = (a, b) => (b.citation_count ?? -1) - (a.citation_count ?? -1);
    const onTopic = [];
    const offTopic = [];
    for (const p of merged) (scoreOf(p) >= CITATION_SORT_RELEVANCE_FLOOR ? onTopic : offTopic).push(p);
    merged = [...onTopic.sort(byCitations), ...offTopic.sort(byCitations)];
  }

  // Post-merge filters
  if (min_citations != null) {
    merged = merged.filter((p) => p.citation_count != null && p.citation_count >= min_citations);
  }
  if (venue_filter?.length) {
    const lv = venue_filter.map((v) => v.toLowerCase());
    merged = merged.filter((p) => p.venue && lv.some((v) => p.venue.toLowerCase().includes(v)));
  }
  if (field_of_study?.length) {
    merged = merged.filter((p) =>
      !p.fields_of_study?.length ||
      field_of_study.some((f) =>
        p.fields_of_study.some((pf) => pf.toLowerCase().includes(f.toLowerCase()))
      )
    );
  }

  // ── Metadata Enrichment ─────────────────────────────────────────────────────
  if (enrich_metadata) {
    try {
      const { enrichFromLandingPages } = await import("./meta-enrich.js");
      await enrichFromLandingPages(merged.slice(0, METADATA_ENRICH_LIMIT), {
        limit: METADATA_ENRICH_LIMIT,
        timeoutMs: METADATA_ENRICH_TIMEOUT_MS,
      }).catch(() => 0);

      // Enrichment can hand a record its first DOI, so collapse again: a VJOL
      // hit and the same paper from OpenAlex only become duplicates once the
      // DOI is known.
      merged = deduplicateAndRank([merged]);
    } catch {
      // Enrichment is an optimisation. Losing it must never lose the results.
    }
  }

  // ── PDF Enrichment ──────────────────────────────────────────────────────────
  if (enrich_pdf) {
    const { findFreePdf } = await import("./pdf-finder.js");

    // First pass: instantly fix papers that have arxiv_id but no pdf_url
    for (const paper of merged) {
      if (!paper.pdf_url && paper.arxiv_id) {
        const cleanId = paper.arxiv_id.replace(/v\d+$/, "");
        paper.pdf_url = `https://arxiv.org/pdf/${cleanId}.pdf`;
        paper.is_oa = true;
      }
    }

    // Second pass: papers with DOI that look like arXiv (10.48550/arXiv.*)
    const arxivDoiRe = /10\.48550\/(?:arXiv|arxiv)\.(.+)/i;
    for (const paper of merged) {
      if (!paper.pdf_url && paper.doi) {
        const m = paper.doi.match(arxivDoiRe);
        if (m) {
          const cleanId = m[1].replace(/v\d+$/, "");
          paper.pdf_url = `https://arxiv.org/pdf/${cleanId}.pdf`;
          paper.is_oa = true;
          paper.arxiv_id = paper.arxiv_id || cleanId;
        }
      }
    }

    const toEnrich = merged
      .filter((p) => !p.pdf_url && !p.arxiv_id && (p.doi || p.s2_id))
      .slice(0, PDF_ENRICH_LIMIT);

    if (toEnrich.length > 0) {
      const ENRICH_CONCURRENCY = 4;
      const enrichDeadline = Date.now() + PDF_ENRICH_TIMEOUT_MS;
      let enrichCursor = 0;

      // PDF_ENRICH_TIMEOUT_MS is meant to cap this whole phase. It did not: the
      // dispatcher `await`ed its way through the stagger and the pool first, and
      // only raced a timer against the *tail*, so a slow batch ran unbounded.
      // A worker pool that checks the deadline before taking the next paper
      // gives the cap its intended meaning.
      async function enrichWorker(slot) {
        if (slot > 0) await new Promise((r) => setTimeout(r, slot * 80));
        for (;;) {
          const i = enrichCursor++;
          if (i >= toEnrich.length) return;
          if (Date.now() >= enrichDeadline) return;
          const paper = toEnrich[i];
          try {
            const res = await findFreePdf({
              title: paper.title || null,
              doi: paper.doi,
              arxiv_id: paper.arxiv_id,
              pmcid: paper.pmcid || null,
              s2PaperId: paper.s2_id || null,
              oa_url: paper.oa_url || null,
              url: paper.url || null,
              s2ApiKey: config.semanticScholarApiKey,
            });
            if (res) {
              paper.pdf_url = res.url;
              paper.is_oa = true;
            }
          } catch {
            // Finding a free PDF is an optimisation — never fail the search.
          }
        }
      }

      const enrichWorkers = Math.min(ENRICH_CONCURRENCY, toEnrich.length);
      await Promise.race([
        Promise.all(Array.from({ length: enrichWorkers }, (_, slot) => enrichWorker(slot))),
        new Promise((resolve) => setTimeout(resolve, PDF_ENRICH_TIMEOUT_MS)),
      ]);
    }
  }

  // Paywalled papers VNU-HCM subscribes to: attach a one-click OpenAthens link.
  // Kept apart from pdf_url — it opens a login page, not a PDF.
  {
    const { institutionalAccessLink } = await import("./pdf-finder.js");
    for (const paper of merged) {
      if (paper.pdf_url || paper.institutional_url) continue;
      const link = institutionalAccessLink({ doi: paper.doi, url: paper.url });
      if (link) paper.institutional_url = link.url;
    }
  }

  // open_access_only: filter AFTER enrichment so we use actual pdf_url presence
  if (open_access_only) {
    merged = merged.filter((p) => Boolean(p.pdf_url));
  }

  // ── Quartile & Takeaway Enrichment ─────────────────────────────────────────
  merged = merged.map(enrichPaperMetrics);

  if (min_quartile) {
    merged = merged.filter((p) => satisfiesMinQuartile(p.quartile, min_quartile));
  }

  // ── Academic Consensus Quantification ──────────────────────────────────────
  let consensus = null;
  if (include_consensus || (isEvaluativeQuery(query) && merged.length >= 2)) {
    consensus = calculateAcademicConsensus(merged, query);
  }

  const total = totals.reduce((s, t) => s + t, 0) || merged.length;
  const filterNote = [
    min_citations != null ? `min_citations=${min_citations}` : "",
    venue_filter?.length ? `venue=[${venue_filter.join(",")}]` : "",
    min_quartile ? `min_quartile=${min_quartile}` : "",
  ].filter(Boolean).join(", ");

  // A source can land in `skipped` twice — the timeout fires, then the request
  // it aborted reports itself unavailable. Report each source once.
  const skippedUnique = [...new Map(skipped.map((s) => [s.id, s])).values()];
  const skippedNote = skippedUnique.length
    ? `\n> ⚠️ Skipped: ${skippedUnique.map((s) => `${s.id} (${s.reason})`).join(", ")}`
    : "";

  const header = `Academic search: "${query}" [${available.join(", ")}]${filterNote ? ` | filters: ${filterNote}` : ""}${skippedNote}`;
  const resultStr = `${header}\n\n${formatResults(merged, total, consensus)}`;

  return { resultStr, papers: merged, consensus, skipped };

}

// ── Paper lookup ──────────────────────────────────────────────────────────────

/**
 * Look up a single paper by ID (DOI, arXiv, PMID, S2 ID).
 * Tries the best source chain for each ID type, enriches with Crossref.
 *
 * @param {string} id
 * @param {Object} config
 * @param {boolean} [fetchPdf=true]
 * @returns {Promise<import("./formatter.js").AcademicPaper|null>}
 */
export async function lookupPaper(id, config = {}, fetchPdf = true) {
  const ck = cacheKey("lookup", { id: String(id).trim().toLowerCase(), fetchPdf });
  const { data } = await cachedOrExecute(ck, TTL.PAPER, async () => {
    return _doLookupPaper(id, config, fetchPdf);
  });
  return data;
}

async function _doLookupPaper(id, config = {}, fetchPdf = true) {
  let trimmed = id.trim();
  let paper = null;

  // "doi:10.x/y" → "10.x/y" (MedPharmRes and a few others emit this form).
  if (/^doi:/i.test(trimmed)) trimmed = trimmed.slice(4).trim();

  // Source-prefixed ID such as "vjol:12345" or "vista_nasati:678". Only the
  // owning plugin understands that ID space, so route straight to it instead
  // of letting the identifier fall through to the Semantic Scholar catch-all
  // (which always returns null for these and made every Vietnamese result
  // impossible to open with academic_get_paper).
  const prefixed = trimmed.match(/^([a-z][a-z0-9_]*):(.+)$/i);
  if (prefixed) {
    const plugin = SOURCES.get(prefixed[1].toLowerCase());
    if (plugin?.getById) {
      paper = await plugin.getById(trimmed, config).catch(() => null);
    }
  }

  if (paper) {
    // Resolved by the owning source plugin — nothing else to try.
  } else if (/^10\.\d{4,}\//.test(trimmed)) {
    // DOI — OpenAlex first, then S2, then Crossref for enrichment
    paper = await openalex.getById(trimmed, config).catch(() => null);
    if (!paper) paper = await semanticScholar.getById(trimmed, config).catch(() => null);
    if (!paper) {
      const cr = await crossref.getById(trimmed, config).catch(() => null);
      paper = cr || null;
    }
    // Enrich with Crossref metadata
    if (paper) {
      const cr = await crossref.getById(trimmed, config).catch(() => null);
      if (cr) paper = { ...paper, volume: paper.volume || cr.volume, issue: paper.issue || cr.issue, pages: paper.pages || cr.pages, venue: paper.venue || cr.venue, issn: paper.issn || cr.issn, publisher: paper.publisher || cr.publisher, abstract: paper.abstract || cr.abstract };
    }
  } else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(trimmed) || trimmed.toLowerCase().startsWith("arxiv:")) {
    const arxivId = trimmed.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
    paper = await arxiv.getById(arxivId, config).catch(() => null);
    if (!paper) paper = await openalex.getById(`10.48550/arXiv.${arxivId}`, config).catch(() => null);
    if (paper && config.semanticScholarApiKey) {
      const s2 = await semanticScholar.getById(arxivId, config).catch(() => null);
      if (s2) paper = { ...paper, citation_count: s2.citation_count ?? paper.citation_count, tldr: s2.tldr || paper.tldr, doi: paper.doi || s2.doi };
    }
  } else if (/^\d{7,8}$/.test(trimmed)) {
    paper = await pubmed.getById(trimmed, config).catch(() => null);
  } else {
    paper = await semanticScholar.getById(trimmed, config).catch(() => null);
  }

  if (!paper) return null;

  // Try to find PDF if not already present
  if (fetchPdf && !paper.pdf_url) {
    const { findFreePdf } = await import("./pdf-finder.js");
    const pdfResult = await findFreePdf({
      title: paper.title || null,
      doi: paper.doi,
      arxiv_id: paper.arxiv_id,
      pmcid: paper.pmcid || null,
      s2PaperId: paper.s2_id || null,
      oa_url: paper.oa_url || null,
      url: paper.url || null,
      s2ApiKey: config.semanticScholarApiKey,
    }).catch(() => null);
    if (pdfResult) paper = { ...paper, pdf_url: pdfResult.url, is_oa: true };
  }
  if (!paper.pdf_url && !paper.institutional_url) {
    const { institutionalAccessLink } = await import("./pdf-finder.js");
    const link = institutionalAccessLink({ doi: paper.doi, url: paper.url });
    if (link) paper = { ...paper, institutional_url: link.url };
  }

  // Research-integrity flag: mark retracted / withdrawn works so a citation is
  // never emitted silently. Non-blocking — a failure here never hides a paper.
  if (paper?.doi) {
    try {
      const { checkRetraction } = await import("./integrity.js");
      const flag = await checkRetraction(paper.doi).catch(() => null);
      if (flag?.retracted) {
        paper = { ...paper, retracted: true, retraction_notice: flag.notice || null };
      }
    } catch {
      // The integrity check is advisory. If the module cannot be loaded the
      // paper is still returned — a lookup must never fail over a flag.
    }
  }

  return paper;
}

// ── Citation / Similar ────────────────────────────────────────────────────────

/**
 * Get citation graph or similar papers for a given paper.
 *
 * @param {string} paperId
 * @param {"citations"|"references"|"similar"} mode
 * @param {number} limit
 * @param {Object} config
 * @returns {Promise<import("./formatter.js").AcademicPaper[]>}
 */
export async function getCiteOrSimilar(paperId, mode = "citations", limit = 10, config = {}) {
  const ck = cacheKey("cite", { paperId: String(paperId).trim().toLowerCase(), mode, limit });
  const { data } = await cachedOrExecute(ck, TTL.CITE, async () => {
    return _doGetCiteOrSimilar(paperId, mode, limit, config);
  });
  return data;
}

async function _doGetCiteOrSimilar(paperId, mode = "citations", limit = 10, config = {}) {
  // Semantic Scholar does not resolve the DataCite-style arXiv DOI
  // ("10.48550/arXiv.2312.10997"); it wants the bare arXiv ID. Normalise first
  // so the same paper is not a hit under one spelling and a 404 under another.
  const s2Id = normaliseIdForS2(paperId);

  if (mode === "similar") {
    return semanticScholar.getSimilarPapers(s2Id, limit, config);
  }

  const s2 = await semanticScholar.getCitationGraph(s2Id, mode, limit, config).catch(() => []);
  if (s2?.length) return s2;

  // Fallback: OpenCitations. Keyless, so the citation graph keeps working when
  // SEMANTIC_SCHOLAR_API_KEY is unset or S2 is rate-limiting.
  const doi = String(paperId).replace(/^doi:/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!/^10\.\d{4,}\//.test(doi)) return s2 || [];
  try {
    const { getCitationGraph } = await import("./opencitations.js");
    return await getCitationGraph(doi, mode, limit).catch(() => s2 || []);
  } catch {
    // Fallback unavailable — return whatever S2 gave us rather than throwing.
    return s2 || [];
  }
}

/**
 * Map any accepted paper identifier onto the spelling Semantic Scholar
 * understands. An arXiv DOI becomes "arXiv:<id>"; everything else is passed
 * through untouched.
 *
 * @param {string} paperId
 * @returns {string}
 */
export function normaliseIdForS2(paperId) {
  const raw = String(paperId || "").trim();
  const m = raw.match(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i);
  if (m) return `arXiv:${m[1].replace(/v\d+$/i, "")}`;
  return raw;
}

// ── Citation Network (ResearchRabbit-inspired) ────────────────────────────────

/**
 * Build a citation network from multiple seed papers.
 * Inspired by ResearchRabbit's "seed → discover network" approach.
 *
 * Returns 3 categories:
 *   - foundational: papers cited by ALL seeds (common references)
 *   - follow_ups:   papers that cite multiple seeds (recent work building on seeds)
 *   - similar:      S2 recommendations for each seed, deduplicated
 *
 * @param {string[]} paperIds  - 2–5 seed paper IDs (DOI/arXiv/PMID/S2)
 * @param {number}   limit     - max results per category
 * @param {Object}   config
 * @returns {Promise<{ foundational: AcademicPaper[], follow_ups: AcademicPaper[], similar: AcademicPaper[] }>}
 */
export async function getCitationNetwork(paperIds, limit = 10, config = {}) {
  // Fetch references + citations + similar for all seeds in parallel
  const seedResults = await Promise.all(
    paperIds.map(async (id) => {
      const [refs, cites, sim] = await Promise.allSettled([
        semanticScholar.getCitationGraph(id, "references", 50, config),
        semanticScholar.getCitationGraph(id, "citations",  50, config),
        semanticScholar.getSimilarPapers(id, 20, config),
      ]);
      return {
        id,
        references: refs.status === "fulfilled" ? refs.value : [],
        citations:  cites.status === "fulfilled" ? cites.value : [],
        similar:    sim.status === "fulfilled"   ? sim.value   : [],
      };
    })
  );

  // Helper: canonical key for a paper (doi preferred, then arxiv, then s2 id)
  const paperKey = (p) => p.doi ? `doi:${p.doi}` : p.arxiv_id ? `arxiv:${p.arxiv_id}` : p.id;

  // Foundational = papers appearing in references of ALL seeds
  // Build frequency map across seeds
  const refFreq = new Map(); // key → { paper, count }
  for (const seed of seedResults) {
    const seen = new Set();
    for (const p of seed.references) {
      const k = paperKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!refFreq.has(k)) refFreq.set(k, { paper: p, count: 0 });
      refFreq.get(k).count++;
    }
  }
  const foundational = [...refFreq.values()]
    .filter((e) => e.count >= Math.max(2, Math.ceil(paperIds.length * 0.5)))
    .sort((a, b) => b.count - a.count || (b.paper.citation_count ?? 0) - (a.paper.citation_count ?? 0))
    .slice(0, limit)
    .map((e) => e.paper);

  // Follow-ups = papers that cite multiple seeds
  const citFreq = new Map();
  for (const seed of seedResults) {
    const seen = new Set();
    for (const p of seed.citations) {
      const k = paperKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!citFreq.has(k)) citFreq.set(k, { paper: p, count: 0 });
      citFreq.get(k).count++;
    }
  }
  const follow_ups = [...citFreq.values()]
    .sort((a, b) => b.count - a.count || (b.paper.year ?? 0) - (a.paper.year ?? 0))
    .slice(0, limit)
    .map((e) => e.paper);

  // Similar = union of S2 recommendations, deduplicated, excluding seeds themselves
  const seedKeys = new Set(paperIds.map((id) => id.toLowerCase()));
  const simFreq  = new Map();
  for (const seed of seedResults) {
    for (const p of seed.similar) {
      const k = paperKey(p);
      if (seedKeys.has(k)) continue;
      if (!simFreq.has(k)) simFreq.set(k, { paper: p, count: 0 });
      simFreq.get(k).count++;
    }
  }
  const similar = [...simFreq.values()]
    .sort((a, b) => b.count - a.count || (b.paper.citation_count ?? 0) - (a.paper.citation_count ?? 0))
    .slice(0, limit)
    .map((e) => e.paper);

  return { foundational, follow_ups, similar };
}
