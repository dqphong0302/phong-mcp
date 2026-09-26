/**
 * PDF finder: walks a priority chain to find a free-access PDF for a given paper.
 *
 * Chain (in order):
 *   0. Already-known OA URL (short-circuit)
 *   0.5. DOI → arXiv extraction (10.48550/arXiv.*)
 *   1. arXiv — always free
 *   2. Unpaywall (requires UNPAYWALL_EMAIL env)
 *   3. Semantic Scholar openAccessPdf
 *   4. OpenAlex best_oa_location
 *   5. PMC OA Web Service (biomedical)
 *   6. Europe PMC fullTextUrl
 *   7. CORE downloadUrl
 *   8. Zenodo API fallback
 *
 * Coverage estimate: ~75-80% of all papers
 */

import { smartFetch } from "./http-client.js";

const UA = `phong-mcp/1.4 (mailto:${process.env.UNPAYWALL_EMAIL || "research@example.com"})`;

async function jsonGet(url, extraHeaders = {}) {
  try {
    const resp = await smartFetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    return resp.json().catch(() => null);
  } catch {
    return null;
  }
}

function candidate(url, source, confidence) {
  return { url, source, confidence, is_oa: true };
}

/** Metadata APIs sometimes list a graphical abstract (e.g. ars.els-cdn.com/…-ga1_lrg.jpg) as the "PDF". */
function isImageUrl(url) {
  return /\.(?:jpe?g|png|gif|webp|svg|tiff?)(?:[?#]|$)/i.test(String(url || ""));
}

/**
 * Find a free PDF URL for a paper, trying multiple sources in priority order.
 *
 * @param {Object} opts
 * @param {string} [opts.doi]
 * @param {string} [opts.arxiv_id]
 * @param {string} [opts.pmcid]        - PubMed Central ID (PMC123456)
 * @param {string} [opts.s2PaperId]    - Semantic Scholar paper ID
 * @param {string} [opts.oa_url]       - Already-known OA URL (short-circuit)
 * @param {string} [opts.s2ApiKey]
 * @returns {Promise<{url:string, source:string, confidence:string, is_oa:boolean}|null>}
 */
export async function findFreePdf(opts = {}) {
  const { doi, arxiv_id, pmcid, s2PaperId, oa_url, url, s2ApiKey } = opts;

  // 0. Already known
  if (oa_url) return candidate(oa_url, "provided", "high");

  // 0.2. Vietnamese OJS / Journal Resolver (VJOL, VAST, JST, UMP, Y Hà Nội, VNU)
  const targetUrl = url || oa_url || "";
  if (targetUrl && (
    targetUrl.includes("vjol.info.vn") ||
    targetUrl.includes("vjs.ac.vn") ||
    targetUrl.includes("jst.vn") ||
    targetUrl.includes("tapchiyhoctphcm.vn") ||
    targetUrl.includes("tapchinghiencuuyhoc.vn") ||
    targetUrl.includes("js.vnu.edu.vn") ||
    targetUrl.includes("/article/view/")
  )) {
    try {
      const resp = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const html = await resp.text();
        const downloadMatch = html.match(/href=["']([^"']*?\/article\/download\/\d+\/\d+[^"']*)["']/i) ||
                              html.match(/href=["']([^"']*?\/article\/view\/\d+\/\d+[^"']*)["']/i) ||
                              html.match(/href=["']([^"']*?\/upload\/[^"']*?\.pdf)["']/i) ||
                              html.match(/href=["'](https?:\/\/[^"']*?\.pdf)["']/i);
        if (downloadMatch) {
          let pdfLink = downloadMatch[1];
          if (pdfLink.includes("/article/view/")) {
            pdfLink = pdfLink.replace("/article/view/", "/article/download/");
          }
          if (!pdfLink.startsWith("http")) {
            const origin = new URL(targetUrl).origin;
            pdfLink = `${origin}${pdfLink}`;
          }
          return candidate(pdfLink, "vietnam_ojs", "high");
        }
      }
    } catch {
      // Non-blocking fallback to standard chain
    }
  }

  // 0.5. DOI → arXiv extraction (e.g. 10.48550/arXiv.2301.12345)
  const arxivFromDoi = doi ? _extractArxivFromDoi(doi) : null;
  const effectiveArxivId = arxiv_id || arxivFromDoi;

  // 1. arXiv — always OA
  if (effectiveArxivId) {
    const cleanId = effectiveArxivId.replace(/v\d+$/, "");
    return candidate(`https://arxiv.org/pdf/${cleanId}.pdf`, "arxiv", "high");
  }

  if (!doi && !s2PaperId && !pmcid) return null;

  // Run all lookups in parallel for speed
  const results = await Promise.allSettled([
    // 2. Unpaywall
    doi && process.env.UNPAYWALL_EMAIL
      ? jsonGet(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(process.env.UNPAYWALL_EMAIL)}`)
      : Promise.resolve(null),

    // 3. Semantic Scholar
    doi || s2PaperId
      ? jsonGet(
          `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(doi ? `DOI:${doi}` : s2PaperId)}?fields=openAccessPdf`,
          s2ApiKey ? { "x-api-key": s2ApiKey } : {}
        )
      : Promise.resolve(null),

    // 4. OpenAlex best_oa_location (NEW)
    doi
      ? jsonGet(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=best_oa_location,open_access&mailto=${process.env.UNPAYWALL_EMAIL || "research@example.com"}`)
      : Promise.resolve(null),

    // 5. PMC OA Web Service (NEW — biomedical papers)
    pmcid
      ? jsonGet(`https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${encodeURIComponent(pmcid)}&format=json`)
      : doi
        ? jsonGet(`https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${encodeURIComponent(doi)}&format=json`)
        : Promise.resolve(null),

    // 6. Europe PMC
    doi
      ? jsonGet(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(doi)}&format=json&resulttype=core`)
      : Promise.resolve(null),

    // 7. CORE
    doi
      ? jsonGet(
          `https://api.core.ac.uk/v3/search/works?q=doi:${encodeURIComponent(doi)}&limit=1`,
          process.env.CORE_API_KEY ? { Authorization: `Bearer ${process.env.CORE_API_KEY}` } : {}
        )
      : Promise.resolve(null),

    // 8. Zenodo
    doi
      ? jsonGet(`https://zenodo.org/api/records?q=doi:"${encodeURIComponent(doi)}"&size=1`)
      : Promise.resolve(null),
  ]);

  const [unpaywall, s2, openalex, pmc, epmc, core, zenodo] =
    results.map((r) => (r.status === "fulfilled" ? r.value : null));

  // Parse Unpaywall (highest priority for non-arXiv)
  if (unpaywall?.is_oa) {
    const best = unpaywall.best_oa_location;
    if (best?.url_for_pdf && !isImageUrl(best.url_for_pdf)) return candidate(best.url_for_pdf, "unpaywall", "high");
    for (const loc of unpaywall.oa_locations || []) {
      if (loc.url_for_pdf && !isImageUrl(loc.url_for_pdf)) return candidate(loc.url_for_pdf, "unpaywall", "medium");
    }
  }

  // Parse Semantic Scholar
  if (s2?.openAccessPdf?.url && !isImageUrl(s2.openAccessPdf.url)) return candidate(s2.openAccessPdf.url, "semantic_scholar", "medium");

  // Parse OpenAlex (NEW)
  const oaLoc = openalex?.best_oa_location;
  if (oaLoc?.pdf_url && !isImageUrl(oaLoc.pdf_url)) return candidate(oaLoc.pdf_url, "openalex", "medium");
  if (oaLoc?.landing_page_url && openalex?.open_access?.is_oa) {
    return candidate(oaLoc.landing_page_url, "openalex", "low");
  }

  // Parse PMC OA Web Service (NEW)
  const pmcLinks = pmc?.records?.[0]?.links || pmc?.link || [];
  const pmcArr = Array.isArray(pmcLinks) ? pmcLinks : [pmcLinks];
  for (const link of pmcArr) {
    const href = link?.href || link;
    if (typeof href === "string" && href.endsWith(".pdf")) {
      return candidate(href, "pmc", "high");
    }
  }
  // PMC also returns XML — check for pdf format
  for (const link of pmcArr) {
    if (link?.format === "pdf" && link?.href) {
      return candidate(link.href, "pmc", "high");
    }
  }

  // Parse Europe PMC
  const epmcUrls = epmc?.resultList?.result?.[0]?.fullTextUrlList?.fullTextUrl || [];
  for (const u of epmcUrls) {
    if (u.documentStyle?.toLowerCase() === "pdf" && (!u.availabilityCode || u.availabilityCode === "OA")) {
      return candidate(u.url, "europepmc", "medium");
    }
  }

  // Parse CORE
  const coreHit = core?.results?.[0];
  if (coreHit?.downloadUrl) return candidate(coreHit.downloadUrl, "core", "low");

  // Parse Zenodo
  const zenodoHit = zenodo?.hits?.hits?.[0];
  if (zenodoHit) {
    const zFiles = zenodoHit.files || zenodoHit.metadata?.files || [];
    const zPdf = zFiles.find((f) => (f.type || f.key || "").toLowerCase().endsWith(".pdf") || (f.type || "") === "pdf");
    if (zPdf) {
      const zUrl = zPdf.links?.self || (zenodoHit.id ? `https://zenodo.org/records/${zenodoHit.id}/files/${zPdf.key}` : null);
      if (zUrl) return candidate(zUrl, "zenodo", "medium");
    }
  }

  // 9. SearXNG Fallback via 9router (Preprints, ResearchGate, Institutional Repositories, PDF filetype)
  const queryTitle = opts.title || "";
  const apiKey = process.env.NINE_ROUTER_API_KEY || "";
  const searchBaseUrl = (
    process.env.NINE_ROUTER_BASE_URL ||
    process.env["9ROUTER_BASE_URL"] ||
    "https://9router.phongdang.io.vn/v1"
  ).replace(/\/$/, "");

  if (queryTitle || doi) {
    try {
      const searxQuery = queryTitle
        ? `"${queryTitle.replace(/["\n\r]/g, " ").trim()}" filetype:pdf`
        : `"${doi}" filetype:pdf`;

      const resp = await fetch(`${searchBaseUrl}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: "searxng",
          query: searxQuery,
          search_type: "science",
          max_results: 5,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const results = data?.results || [];
        for (const item of results) {
          const itemUrl = item.url || "";
          const looksLikePdf =
            itemUrl.toLowerCase().endsWith(".pdf") ||
            itemUrl.toLowerCase().includes("/pdf/") ||
            itemUrl.toLowerCase().includes(".pdf?") ||
            itemUrl.includes("arxiv.org/pdf/") ||
            itemUrl.includes("researchgate.net/publication/") ||
            itemUrl.includes("biorxiv.org/content/") ||
            itemUrl.includes("medrxiv.org/content/");
          if (!looksLikePdf) continue;

          // A web search returns whatever ranked highest — not necessarily THIS
          // paper. Attaching an unverified hit is worse than attaching nothing:
          // the citation looks resolved while pointing at someone else's PDF.
          if (!_isPdfForPaper(item, { doi, title: queryTitle })) continue;

          return candidate(itemUrl, "searxng_9router", "medium");
        }
      }
    } catch {
      // Non-blocking fallback
    }
  }

  return null;
}

// ── VNU-HCM institutional access (OpenAthens) ─────────────────────────────────
//
// Not a PDF: the redirector sends the browser through the VNU-HCM OpenAthens
// login and then on to the publisher page. It is returned separately from
// findFreePdf so callers never store it as `pdf_url` or flag the paper as OA.

const VNU_OPENATHENS_REDIRECTOR =
  process.env.VNULIB_OPENATHENS_REDIRECTOR || "https://go.openathens.net/redirector/vnu.edu.vn";

/** DOI prefixes of publishers VNU-HCM subscribes to (mirrors services/vnulib/openathens.py). */
const VNU_DOI_PREFIXES = {
  "10.1016/": "Elsevier ScienceDirect",
  "10.1007/": "SpringerLink",
  "10.1109/": "IEEE Xplore",
  "10.1038/": "Nature",
  "10.1021/": "ACS Publications",
  "10.1093/": "Oxford Academic",
  "10.1097/": "OVID LWW",
  "10.1115/": "ASME Digital Collection",
};

const VNU_DOMAINS = {
  "sciencedirect.com": "Elsevier ScienceDirect",
  "scopus.com": "Scopus",
  "springer.com": "SpringerLink",
  "nature.com": "Nature",
  "ieeexplore.ieee.org": "IEEE Xplore",
  "pubs.acs.org": "ACS Publications",
  "proquest.com": "ProQuest",
  "ovid.com": "OVID LWW",
  "academic.oup.com": "Oxford Academic",
  "mathscinet.ams.org": "MathSciNet",
  "asmedigitalcollection.asme.org": "ASME Digital Collection",
};

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * One-click link to a paywalled paper through VNU-HCM's OpenAthens login.
 * Prefers the DOI (stable, lands on the publisher) over whatever `url` the
 * source reported, which may be PubMed or an aggregator.
 *
 * @param {{doi?: string, url?: string}} paper
 * @returns {{url: string, target: string, publisher: string, institution: string}|null}
 */
export function institutionalAccessLink({ doi, url } = {}) {
  const cleanDoi = String(doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  let target = null;
  let publisher = null;

  const prefix = Object.keys(VNU_DOI_PREFIXES).find((p) => cleanDoi.toLowerCase().startsWith(p));
  if (prefix) {
    target = `https://doi.org/${cleanDoi}`;
    publisher = VNU_DOI_PREFIXES[prefix];
  } else if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const domain = Object.keys(VNU_DOMAINS).find((d) => hostMatches(host, d));
      if (domain) {
        target = url; // keep original case: paths such as ScienceDirect PIIs are case-sensitive
        publisher = VNU_DOMAINS[domain];
      }
    } catch {
      // not a URL
    }
  }
  if (!target) return null;

  return {
    url: `${VNU_OPENATHENS_REDIRECTOR}?url=${encodeURIComponent(target)}`,
    target,
    publisher,
    institution: "VNU-HCM (OpenAthens)",
  };
}

/**
 * Does this web-search hit actually belong to the paper we asked about?
 *
 * A hit is accepted when the DOI appears in the result, or when the result's
 * own title covers most of the paper's title. Everything else is rejected —
 * this is the check that stops a search for a RAG-in-healthcare review from
 * returning a Gemini technical report because both mention "Gemini".
 *
 * @param {Object} item   search result ({ url, title, content })
 * @param {Object} paper  { doi, title }
 * @returns {boolean}
 */
function _isPdfForPaper(item, paper = {}) {
  const doi = String(paper.doi || "").toLowerCase();
  const haystack = `${item.url || ""} ${item.title || ""} ${item.content || ""}`.toLowerCase();

  // A DOI match is unambiguous.
  if (doi && haystack.includes(doi)) return true;

  const wanted = String(paper.title || "").trim();
  if (wanted.length < 12) return false;

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const wantedWords = norm(wanted);
  if (wantedWords.length === 0) return false;

  const hit = new Set(norm(`${item.title || ""} ${item.url || ""}`));
  const overlap = wantedWords.filter((w) => hit.has(w)).length / wantedWords.length;
  return overlap >= 0.6;
}

/**
 * Extract arXiv ID from a DOI string.
 * Handles patterns like:
 *   10.48550/arXiv.2301.12345
 *   10.48550/arxiv.2301.12345v2
 * @param {string} doi
 * @returns {string|null}
 */
function _extractArxivFromDoi(doi) {
  if (!doi) return null;
  // Pattern: 10.48550/arXiv.NNNN.NNNNN or 10.48550/arxiv.NNNN.NNNNN
  const m = doi.match(/10\.48550\/(?:arXiv|arxiv)\.(.+)/i);
  if (m) return m[1].replace(/v\d+$/, "");
  return null;
}
