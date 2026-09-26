/**
 * Academic search MCP tools registration.
 * Exposes tools:
 *   - academic_search       : multi-source parallel search (15 sources, plugin architecture)
 *   - academic_get_paper    : detail lookup by DOI / arXiv ID / S2 ID + PDF finder + optional download
 *   - academic_cite         : citation graph + similar papers (mode param)
 *   - academic_batch_format : format citations in bulk (single or batch)
 *   - academic_import_file  : import papers from exported reference files (BibTeX/RIS/Scopus/WoS/MEDLINE/CSL)
 *   - academic_fulltext     : full text of an OA paper from PubMed Central (not just the abstract)
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { academic as config } from "../config.js";
import { ok, err } from "../utils.js";
import { cacheGet, cacheSet, cacheKey, TTL, cacheStats } from "./cache.js";
import { formatResults, formatCitation, formatConsensusReport } from "./formatter.js";
import { calculateAcademicConsensus } from "./consensus.js";
import { runEvidenceCheck } from "./evidence-check.js";
import { runExtract } from "./extract.js";
import { parseReferenceFile } from "./import-file.js";
import { generatePrismaFlowDiagram } from "./prisma.js";
import { runMetaAnalysis } from "./meta-analysis.js";
import { assessRiskOfBias } from "./risk-of-bias.js";
import { extractTables } from "./table-extractor.js";
import { generateObsidianMoc } from "./obsidian-moc.js";
import { fetchTrendsData } from "./trends.js";
import {
  calculateCohenKappa,
  adjudicateScreeningConflict,
  createScreeningProject,
  recordScreeningVote,
  adjudicateProjectConflicts,
  getScreeningProjectReport,
  listScreeningProjects,
  COCHRANE_EXCLUSION_REASONS,
} from "./screening.js";
import {
  registerLivingReview,
  checkLivingReviewUpdates,
  listLivingReviews,
  getLivingReviewDetails,
} from "./living-review.js";
import { assessGradeOutcome, generateGradeSoFTable } from "./grade.js";
import { analyzePublicationBias } from "./publication-bias.js";
import { getChecklistTemplate, generateEquatorChecklistReport } from "./equator-checklists.js";
import { generateProsperoProtocol, generateRebuttalMatrix } from "./protocol-rebuttal.js";
import { fetchClinicalTrialResults } from "./clinicaltrials-extractor.js";
import { fetchPmcArticleTables } from "./pmc-extractor.js";
import { generateRobvisReport, generateTrafficLightPlotSVG, generateSummaryBarSVG } from "./robvis.js";
import { runLeaveOneOutAnalysis, runSubgroupAnalysis } from "./sensitivity-subgroup.js";
import { runBucherITC, generateNetworkGeometrySVG } from "./indirect-comparison.js";
import { synthesizeImradManuscript } from "./imrad-synthesizer.js";
import { lookupJournalRank } from "./journal-rank.js";
import { compareTexts, deduplicateList } from "./text-similarity.js";


import {
  runParallelSearch,
  lookupPaper,
  getCiteOrSimilar,
  getCitationNetwork,
} from "./orchestrator.js";

import { SOURCES, SOURCE_PRESETS } from "./sources/registry.js";

import { getOpenAlexWork } from "./sources/openalex.js";
import { getArxivPaper } from "./sources/arxiv.js";
import { getPubMedArticle } from "./sources/pubmed.js";
import { getSemanticScholarPaper } from "./sources/semantic-scholar.js";
import { fetchFullText as fetchPmcFullText, resolvePmcid } from "./sources/pmc.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

// Dynamic enums from registry — auto-stay in sync when sources are added
const SourceEnum = z.enum(/** @type {[string, ...string[]]} */ ([...SOURCES.keys()]));
const PresetEnum = z.enum(/** @type {[string, ...string[]]} */ (Object.keys(SOURCE_PRESETS)));
const SourceOrPresetEnum = z.enum(/** @type {[string, ...string[]]} */ ([...SOURCES.keys(), ...Object.keys(SOURCE_PRESETS)]));

const SortEnum = z.enum(["relevance", "citations", "recency"]);
const CiteModeEnum = z.enum(["citations", "references", "similar", "network"]);
const CitationStyleEnum = z.enum(["apa", "ieee", "bibtex", "vancouver", "mla"]);

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerAcademicTools(server) {

  // ── academic_search ─────────────────────────────────────────────────────────
  server.tool(
    "academic_search",
    `Search ${SOURCES.size} academic databases in parallel across Vietnamese & international literature with deduplication and RRF ranking. ` +
    "8 Core Domain Presets: 'vietnam' (130+ VN journals, VAST, HUST, VNU, UMP, NASATI), 'biomedical' (PubMed, PMC fulltext, Trials, Drugs, UniProt, ClinVar), 'ai_cs' (arXiv, S2, DBLP, HF, OpenReview, PapersWithCode, Security), 'stem_nature' (Physics, Chem, Energy, Materials, Aero), 'social_humanities' (Economics, Education, Social, Books, Theses), 'evidence_review' (Systematic reviews, EBM, Consensus), 'patents_gov' (Patents, Gov docs, Grants), 'global_regional' (Asia-Pacific, Global South, Africa, LatAm). " +
    `4 Utility Modes: 'default' (Fast multi-domain), 'open_access' (100% Free PDF), 'preprints' (Early manuscripts), 'exhaustive' (All ${SOURCES.size} sources). Legacy preset names are automatically aliased.`,
    {
      query: z.string().describe(
        "Search query (natural language or keywords). Boolean operators supported for S2/PubMed."
      ),
      sources: z.union([
        z.array(SourceOrPresetEnum),
        SourceOrPresetEnum, // a single source id ("vnulib") or a preset name
      ]).optional().default("default").describe(
        'Sources to query. Core presets: "vietnam", "biomedical", "ai_cs", "stem_nature", "social_humanities", "evidence_review", "patents_gov", "global_regional", "open_access", "preprints", "exhaustive", "default". Legacy preset names and source IDs are fully supported.'
      ),
      year_min: z.number().int().min(1900).max(2030).optional().describe("Filter: earliest publication year."),
      year_max: z.number().int().min(1900).max(2030).optional().describe("Filter: latest publication year."),
      open_access_only: z.boolean().optional().default(false).describe("Only return papers with free PDF."),
      sort: SortEnum.optional().default("relevance").describe("Sort order: relevance | citations | recency."),
      limit: z.number().int().min(1).max(100).optional().default(10).describe("Max papers per source (1-100)."),
      arxiv_categories: z.array(z.string()).optional().describe('arXiv category filter. E.g. ["cs.AI","cs.LG"].'),
      min_citations: z.number().int().min(0).optional().describe("Post-filter: only papers with >= N citations."),
      venue_filter: z.array(z.string()).optional().describe('Post-filter: only papers from these venues (substring match). E.g. ["NeurIPS","Nature"].'),
      field_of_study: z.array(z.string()).optional().describe('Post-filter: S2 fields of study. E.g. ["Computer Science","Medicine"].'),
      min_quartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional().describe("Filter: only return papers from journals of this minimum quartile or higher (Q1, Q2, Q3, Q4)."),
      include_trends: z.boolean().optional().default(false).describe("If true, enriches search results with real-time Google Trends public interest metrics (SVI 0-100), trend direction, and rising queries."),
      include_consensus: z.boolean().optional().default(false).describe("If true, quantifies scientific consensus (Yes / Inconclusive / No) based on evidence weighting (study design, Q1-Q4, sample size N)."),
    },
    async ({ query, sources, year_min, year_max, open_access_only, sort, limit, arxiv_categories, min_citations, venue_filter, field_of_study, min_quartile, include_trends, include_consensus }) => {
      try {
        const ck = cacheKey("academic_search", { query, sources, year_min, year_max, open_access_only, sort, limit, arxiv_categories, min_citations, venue_filter, field_of_study, min_quartile, include_trends, include_consensus });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        let { resultStr } = await runParallelSearch(query, sources, {
          limit, year_min, year_max, open_access_only, sort,
          arxiv_categories, min_citations, venue_filter, field_of_study, min_quartile, include_consensus,
        }, config);

        if (include_trends) {
          try {
            const trendsData = await fetchTrendsData({ keyword: query, geo: "VN" });
            const rising = trendsData.risingQueries.slice(0, 5).map(r => `${r.query} (${r.value})`).join(", ");
            const expansion = trendsData.expansionKeywords.slice(0, 5).join(", ");
            const trendsSummary = [
              "",
              "---",
              "### 📊 Google Trends — Xu Hướng Quan Tâm Cộng Đồng & Gợi Ý Mở Rộng",
              `- **Từ khóa / Khu vực**: ${trendsData.keyword} (${trendsData.geo})`,
              `- **Chỉ số SVI hiện tại**: ${trendsData.metrics.currentInterest}/100 (Trung bình: ${trendsData.metrics.averageInterest}, Đỉnh: ${trendsData.metrics.peakInterest.value} vào ${trendsData.metrics.peakInterest.date})`,
              `- **Động lực xu hướng (Trend Momentum)**: **${trendsData.metrics.trendDirection.toUpperCase()}**`,
              `- **Truy vấn bùng nổ (Rising / Breakout Queries)**: ${rising || "Không có"}`,
              `- **Từ khóa gợi ý mở rộng y văn**: ${expansion || "Không có"}`,
              `- **Chỉ báo khoảng trống nghiên cứu (Research Gap)**: Mức độ quan tâm cộng đồng đạt ${trendsData.metrics.currentInterest}/100 — đối chiếu số lượng công bố y văn để xác định các khía cạnh bệnh nhân băn khoăn nhưng y văn còn thiếu dữ liệu thực chứng.`,
              ""
            ].join("\n");
            resultStr += trendsSummary;
          } catch (tErr) {
            console.error("[AcademicSearch] Google Trends enrichment skipped:", tErr.message);
          }
        }

        cacheSet(ck, resultStr, TTL.SEARCH);
        return ok(resultStr);
      } catch (e) {
        return err(`academic_search failed: ${e.message}`);
      }
    }
  );

  // ── academic_consensus ──────────────────────────────────────────────────────
  server.tool(
    "academic_consensus",
    "Quantify scientific consensus on a directional research question or hypothesis. " +
    "Retrieves peer-reviewed evidence (PubMed, Scopus Q1-Q4 journals, S2, Crossref), " +
    "classifies stances (Yes / No / Inconclusive), applies EBM evidence weighting " +
    "(Meta-analysis/RCT hierarchy, journal quartile, sample size N), and produces a " +
    "quantified Consensus Meter report with supporting and refuting citations.",
    {
      query: z.string().describe("The research question or hypothesis. E.g. 'Does semaglutide reduce cardiovascular events?' or 'kẽm có rút ngắn thời gian cảm lạnh'."),
      sources: z.array(z.string()).optional().describe("Optional source databases. Defaults to all academic databases."),
      min_quartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional().describe("Filter: only evaluate journals of this minimum quartile or higher (e.g. Q1 for highest rigor)."),
      limit: z.number().int().min(5).max(30).optional().default(15).describe("Number of papers to evaluate (5-30)."),
    },
    async ({ query, sources, min_quartile, limit }) => {
      try {
        const ck = cacheKey("academic_consensus", { query, sources, min_quartile, limit });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const searchRes = await runParallelSearch(query, sources, {
          limit,
          min_quartile,
          include_consensus: true,
        }, config);

        const report = formatConsensusReport(searchRes.consensus, searchRes.papers, query);
        cacheSet(ck, report, TTL.SEARCH);
        return ok(report);
      } catch (e) {
        return err(`academic_consensus failed: ${e.message}`);
      }
    }
  );


  // ── academic_cite ───────────────────────────────────────────────────────────
  server.tool(
    "academic_cite",
    "Explore citation graph or find similar papers. " +
    "mode='citations': papers that cite this paper. " +
    "mode='references': papers this paper cites. " +
    "mode='similar': papers similar to this (S2 Recommendations API). " +
    "mode='network': ResearchRabbit-style — supply paper_ids (2-5 seeds) to discover " +
    "foundational papers (cited by all seeds), follow-up papers (cite multiple seeds), " +
    "and similar papers across the whole cluster.",
    {
      paper_id: z.string().optional().describe(
        "Single paper ID: DOI (10.xxx/...), arXiv ID (2301.12345), or Semantic Scholar paper ID. " +
        "Used for modes: citations, references, similar."
      ),
      paper_ids: z.array(z.string()).min(2).max(5).optional().describe(
        "For mode='network': 2–5 seed paper IDs to build a citation network from. " +
        "Discovers foundational, follow-up, and similar papers across all seeds."
      ),
      mode: CiteModeEnum.optional().default("citations").describe(
        '"citations" = who cites this. "references" = what this cites. ' +
        '"similar" = S2 recommendations. "network" = multi-seed discovery (requires paper_ids).'
      ),
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Max results per category (1-50)."),
    },
    async ({ paper_id, paper_ids, mode, limit }) => {
      try {
        // ── Network mode (ResearchRabbit-style multi-seed) ──
        if (mode === "network") {
          const seeds = paper_ids ?? (paper_id ? [paper_id] : []);
          if (seeds.length < 2) return err("mode='network' requires at least 2 seed paper IDs via paper_ids.");
          const ck = cacheKey("academic_cite_network", { seeds: [...seeds].sort().join(","), limit });
          const cached = cacheGet(ck);
          if (cached) return ok(cached);

          const { foundational, follow_ups, similar } = await getCitationNetwork(seeds, limit, config);
          const lines = [
            `## Citation Network for ${seeds.length} seed papers`,
            `Seeds: ${seeds.join(", ")}`,
            "",
          ];
          if (foundational.length) {
            lines.push(`### 🏛️ Foundational Papers (cited by multiple seeds — ${foundational.length})`);
            lines.push("*Papers appearing in references of 2+ seeds = likely seminal works in this area.*");
            lines.push("");
            lines.push(formatResults(foundational, foundational.length));
          }
          if (follow_ups.length) {
            lines.push(`### 🚀 Follow-up Papers (cite multiple seeds — ${follow_ups.length})`);
            lines.push("*Recent papers building on these seeds.*");
            lines.push("");
            lines.push(formatResults(follow_ups, follow_ups.length));
          }
          if (similar.length) {
            lines.push(`### 🔗 Related Papers (S2 recommendations — ${similar.length})`);
            lines.push("");
            lines.push(formatResults(similar, similar.length));
          }
          if (!foundational.length && !follow_ups.length && !similar.length) {
            return ok("No network found. Check that paper IDs are valid S2/DOI/arXiv identifiers.");
          }
          const resultStr = lines.join("\n");
          cacheSet(ck, resultStr, TTL.SEARCH);
          return ok(resultStr);
        }

        // ── Single-paper modes (citations / references / similar) ──
        const id = paper_id ?? paper_ids?.[0];
        if (!id) return err("Provide paper_id (or paper_ids[0]) for modes: citations, references, similar.");
        const ck = cacheKey("academic_cite", { id, mode, limit });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const papers = await getCiteOrSimilar(id, mode, limit, config);
        if (!papers.length) return ok(`No ${mode} found for paper: ${id}`);

        const modeLabel = { citations: "Citing papers", references: "References", similar: "Similar papers" }[mode];
        const resultStr = `**${modeLabel}** for: ${id} (${papers.length} results)\n\n${formatResults(papers, papers.length)}`;
        cacheSet(ck, resultStr, mode === "similar" ? TTL.SIMILAR : TTL.SEARCH);
        return ok(resultStr);
      } catch (e) {
        return err(`academic_cite failed: ${e.message}`);
      }
    }
  );

  // ── academic_get_paper ──────────────────────────────────────────────────────
  server.tool(
    "academic_get_paper",
    "Get full details of a paper by DOI, arXiv ID, PubMed ID (PMID), or Semantic Scholar ID. " +
    "Automatically tries the best source chain and enriches with Crossref metadata. " +
    "Set fetch_pdf=true (default) to also find a free open-access PDF via Unpaywall/arXiv/S2/EuropePMC.",
    {
      id: z.string().describe(
        'Paper identifier. Examples: DOI "10.1038/s41586-021-03819-2", arXiv "2301.12345", PMID "34385704", S2 hex ID.'
      ),
      fetch_pdf: z.boolean().optional().default(true).describe(
        "Attempt to find a free open-access PDF URL. Default: true."
      ),
      download: z.boolean().optional().default(false).describe(
        "If true AND a free PDF is found, download the PDF and save to save_dir."
      ),
      save_dir: z.string().optional().describe(
        "Directory to save downloaded PDFs. Default: ./academic-pdfs (relative to cwd). " +
        "Example: /Users/phongdang/Documents/papers"
      ),
    },
    async ({ id: paperId, fetch_pdf, download, save_dir }) => {
      try {
        const trimmed = paperId.trim();
        const ck = cacheKey("academic_get_paper", { id: trimmed, fetch_pdf });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const paper = await lookupPaper(trimmed, config, fetch_pdf);
        if (!paper) return err(`No paper found for ID: ${paperId}`);

        const lines = [
          `# ${paper.title}`,
          `**Authors**: ${paper.authors.join(", ") || "Unknown"}`,
          `**Year**: ${paper.year || "Unknown"}`,
          `**Source**: ${paper.source}`,
        ];
        if (paper.venue) {
          let v = `**Venue**: ${paper.venue}`;
          if (paper.volume) v += `, Vol. ${paper.volume}`;
          if (paper.issue) v += `(${paper.issue})`;
          if (paper.pages) v += `, pp. ${paper.pages}`;
          lines.push(v);
        }
        if (paper.issn)      lines.push(`**ISSN**: ${paper.issn}`);
        if (paper.publisher) lines.push(`**Publisher**: ${paper.publisher}`);
        if (paper.doi)       lines.push(`**DOI**: https://doi.org/${paper.doi}`);
        if (paper.arxiv_id)  lines.push(`**arXiv**: https://arxiv.org/abs/${paper.arxiv_id}`);
        if (paper.url && !paper.doi && !paper.arxiv_id) lines.push(`**URL**: ${paper.url}`);
        if (paper.citation_count != null) lines.push(`**Citations**: ${paper.citation_count}`);
        if (paper.is_oa)     lines.push(`**Open Access**: ✅ Yes`);
        if (!paper.pdf_url && paper.institutional_url) {
          lines.push(`**Truy cập VNU-HCM**: ${paper.institutional_url} 🔑 (không có bản miễn phí — mở link, đăng nhập OpenAthens)`);
        }
        if (paper.fulltext_url) lines.push(`**Toàn văn (thư viện)**: ${paper.fulltext_url}`);
        if (paper.pdf_url) {
          lines.push(`**PDF (OA)**: ${paper.pdf_url} ✅`);
          // Download PDF if requested
          if (download) {
            try {
              const pdfResp = await fetch(paper.pdf_url, {
                headers: { "User-Agent": "phong-mcp/1.4 (academic-search)" },
                signal: AbortSignal.timeout(60000),
              });
              if (pdfResp.ok) {
                const MAX_PDF_BYTES = 50 * 1024 * 1024;
                const contentLength = parseInt(pdfResp.headers.get("content-length") || "0", 10);
                if (contentLength > MAX_PDF_BYTES) {
                  lines.push(`**Download skipped**: PDF too large (${Math.round(contentLength / 1024 / 1024)} MB > 50 MB limit)`);
                } else {
                  const arrayBuf = await pdfResp.arrayBuffer();
                  const buf = Buffer.from(arrayBuf);
                  if (buf.length > MAX_PDF_BYTES) {
                    lines.push(`**Download skipped**: PDF too large (${Math.round(buf.length / 1024 / 1024)} MB > 50 MB limit)`);
                  } else {
                    const safeTitle = (paper.title || "paper")
                      .replace(/[^a-z0-9]/gi, "_")
                      .replace(/_+/g, "_")
                      .slice(0, 60)
                      .toLowerCase();
                    const year = paper.year ? `_${paper.year}` : "";
                    const filename = `${safeTitle}${year}.pdf`;
                    const base = (process.cwd() === "/" || !process.cwd()) ? "/Users/phongdang/home-server/downloaded_papers" : join(process.cwd(), "downloaded_papers");
                    const dir = save_dir || base;
                    mkdirSync(dir, { recursive: true });
                    const filepath = join(dir, filename);
                    writeFileSync(filepath, buf);
                    lines.push(`**Downloaded**: \`${filepath}\` (${Math.round(buf.length / 1024)} KB) 💾`);
                    const b64 = buf.toString("base64");
                    lines.push(`\n<pdf_base64 filename="${filename}" size_kb="${Math.round(buf.length / 1024)}">${b64}</pdf_base64>`);
                  }
                }
              } else {
                lines.push(`**Download failed**: HTTP ${pdfResp.status} — PDF URL may require auth`);
              }
            } catch (dlErr) {
              lines.push(`**Download failed**: ${dlErr.message}`);
            }
          }
        }
        // PapersWithCode extras
        if (paper.github_url) lines.push(`**Code**: ${paper.github_url} 💻`);
        if (paper.tasks?.length) lines.push(`**Tasks**: ${paper.tasks.join(", ")}`);
        if (paper.tldr)      lines.push(`\n**TL;DR**: ${paper.tldr}`);
        if (paper.abstract)  lines.push(`\n**Abstract**: ${paper.abstract}`);

        const resultStr = lines.join("\n");
        cacheSet(ck, resultStr, TTL.PAPER);
        return ok(resultStr);
      } catch (e) {
        return err(`academic_get_paper failed: ${e.message}`);
      }
    }
  );

  // ── academic_batch_format ───────────────────────────────────────────────
  server.tool(
    "academic_batch_format",
    "Format one or more papers into citations. Single paper: pass paper_id. Batch: pass paper_ids (max 20). " +
    "Supports APA 7th, IEEE, BibTeX, Vancouver, MLA 9th. output_format='bibtex_only' = combined .bib file.",
    {
      paper_id:  z.string().optional().describe("Single paper ID (DOI/arXiv/PMID)."),
      paper_ids: z.array(z.string()).min(1).max(50).optional().describe("Batch: list of paper IDs. Max 50."),
      title:     z.string().optional(),
      authors:   z.array(z.string()).optional(),
      year:      z.number().int().optional(),
      venue:     z.string().optional(),
      volume:    z.string().optional(),
      issue:     z.string().optional(),
      pages:     z.string().optional(),
      doi:       z.string().optional(),
      publisher: z.string().optional(),
      type:      z.enum(["article","conference","preprint","book_chapter","other"]).optional().default("article"),
      styles:    z.array(CitationStyleEnum).optional().default(["apa","ieee","bibtex"]),
      output_format: z.enum(["text","bibtex_only"]).optional().default("text"),
      start_index: z.number().int().min(1).optional().default(1),
    },
    async ({ paper_id, paper_ids, title, authors, year, venue, volume, issue, pages, doi, publisher, type, styles, output_format, start_index }) => {
      try {
        const ids = paper_ids ?? (paper_id ? [paper_id] : []);
        const manualFields = { title, authors, year, venue, volume, issue, pages, doi, publisher, type };
        const hasManual = Object.values(manualFields).some((v) => v != null);
        const fetchedPapers = [];
        const errors = [];

        if (ids.length > 0) {
          const CONCURRENCY = 3;
          for (let i = 0; i < ids.length; i += CONCURRENCY) {
            const results = await Promise.all(
              ids.slice(i, i + CONCURRENCY).map(async (id) => {
                try { return { id, paper: await lookupPaper(id.trim(), config, false) }; }
                catch (e) { return { id, error: e.message }; }
              })
            );
            for (const r of results) {
              if (r.error) errors.push(`- ${r.id}: ${r.error}`);
              else if (r.paper) {
                const p = hasManual ? { ...r.paper, ...Object.fromEntries(Object.entries(manualFields).filter(([, v]) => v != null)) } : r.paper;
                fetchedPapers.push(p);
              } else errors.push(`- ${r.id}: not found`);
            }
          }
        } else if (hasManual) {
          fetchedPapers.push({ id: doi ? `doi:${doi}` : "manual", title: title || "(untitled)", authors: authors || [], year: year || null, doi: doi || null, arxiv_id: null, abstract: null, citation_count: null, pdf_url: null, url: doi ? `https://doi.org/${doi}` : null, source: "manual", venue: venue || null, tldr: null, volume: volume || null, issue: issue || null, pages: pages || null, publisher: publisher || null, type: type || "article", issn: null, is_oa: false });
        } else {
          return err("Provide paper_id, paper_ids, or manual fields.");
        }

        if (!fetchedPapers.length) return err(`No papers fetched.\n${errors.join("\n")}`);

        const styleLabels = { apa: "APA 7th", ieee: "IEEE", bibtex: "BibTeX", vancouver: "Vancouver", mla: "MLA 9th" };
        const lines = [`# Citation${fetchedPapers.length > 1 ? `s (${fetchedPapers.length})` : `: ${fetchedPapers[0].title}`}\n`];

        if (output_format === "bibtex_only") {
          lines.push("```bibtex");
          fetchedPapers.forEach((p, i) => { lines.push(formatCitation(p, "bibtex", start_index + i)); lines.push(""); });
          lines.push("```");
        } else {
          fetchedPapers.forEach((paper, i) => {
            if (fetchedPapers.length > 1) lines.push(`## [${start_index + i}] ${paper.title}`);
            if (paper.authors?.length) lines.push(`**Authors**: ${paper.authors.join(", ")}`);
            if (paper.year) lines.push(`**Year**: ${paper.year}`);
            if (paper.doi) lines.push(`**DOI**: https://doi.org/${paper.doi}`);
            lines.push("");
            for (const style of styles) {
              lines.push(`### ${styleLabels[style] || style}`);
              if (style === "bibtex") { lines.push("```bibtex"); lines.push(formatCitation(paper, style, start_index + i)); lines.push("```"); }
              else lines.push(formatCitation(paper, style, start_index + i));
              lines.push("");
            }
          });
        }
        if (errors.length) lines.push(`\n> ⚠️ ${errors.length} not found:\n${errors.join("\n")}`);
        return ok(lines.join("\n"));
      } catch (e) {
        return err(`academic_batch_format failed: ${e.message}`);
      }
    }
  );

  // ── academic_batch_download ───────────────────────────────────────────────────
  server.tool(
    "academic_batch_download",
    "Batch download free open-access PDFs for a list of paper IDs or direct PDF URLs. " +
    "Automatically finds PDF URLs via the enrichment chain (arXiv, Unpaywall, S2, OpenAlex, PMC, CORE, Zenodo). " +
    "Downloads are saved to save_dir. Concurrency: 3 simultaneous downloads.",
    {
      paper_ids: z.array(z.string()).min(1).max(50).optional().describe(
        "List of paper IDs (DOI, arXiv ID, PMID, S2 ID). Max 50. " +
        "System will find the free PDF URL for each."
      ),
      pdf_urls: z.array(z.string().url()).min(1).max(50).optional().describe(
        "List of direct PDF URLs to download (skip lookup). Max 50."
      ),
      save_dir: z.string().optional().describe(
        "Directory to save PDFs. Default: ./academic-pdfs (relative to cwd). " +
        "Example: /Users/phongdang/Documents/papers"
      ),
      skip_existing: z.boolean().optional().default(true).describe(
        "Skip download if file already exists in save_dir. Default: true."
      ),
    },
    async ({ paper_ids, pdf_urls, save_dir, skip_existing }) => {
      try {
        if (!paper_ids?.length && !pdf_urls?.length) {
          return err("Provide paper_ids or pdf_urls.");
        }

        const { findFreePdf, institutionalAccessLink } = await import("./pdf-finder.js");
        const { existsSync } = await import("fs");
        const base = (process.cwd() === "/" || !process.cwd()) ? "/Users/phongdang/home-server/downloaded_papers" : join(process.cwd(), "downloaded_papers");
        const dir = save_dir || base;
        mkdirSync(dir, { recursive: true });

        // Build download jobs: { title, filename, url }
        const jobs = [];
        const lookupErrors = [];

        // From paper_ids — resolve to pdf_url via lookup + enrichment
        if (paper_ids?.length) {
          const LOOKUP_CONCURRENCY = 3;
          for (let i = 0; i < paper_ids.length; i += LOOKUP_CONCURRENCY) {
            const batch = paper_ids.slice(i, i + LOOKUP_CONCURRENCY);
            const resolved = await Promise.all(
              batch.map(async (id) => {
                try {
                  const paper = await lookupPaper(id.trim(), config, true);
                  if (!paper) return { id, error: "Paper not found" };
                  if (!paper.pdf_url) {
                    // Try extra enrichment
                    const res = await findFreePdf({
                      doi: paper.doi,
                      arxiv_id: paper.arxiv_id,
                      pmcid: paper.pmcid || null,
                      s2PaperId: paper.s2_id || null,
                      s2ApiKey: config.semanticScholarApiKey,
                    }).catch(() => null);
                    if (res?.url) paper.pdf_url = res.url;
                  }
                  // Fallback the user can open in one click when we cannot fetch the PDF.
                  const access = paper.institutional_url
                    || institutionalAccessLink({ doi: paper.doi, url: paper.url })?.url
                    || paper.fulltext_url
                    || null;
                  if (!paper.pdf_url) {
                    return { id, error: access ? `No free PDF found — mở nhanh: ${access}` : "No free PDF found" };
                  }
                  const safeTitle = (paper.title || id)
                    .replace(/[^a-z0-9]/gi, "_")
                    .replace(/_+/g, "_")
                    .slice(0, 60)
                    .toLowerCase();
                  const yearSuffix = paper.year ? `_${paper.year}` : "";
                  return { id, url: paper.pdf_url, filename: `${safeTitle}${yearSuffix}.pdf`, title: paper.title, access };
                } catch (e) {
                  return { id, error: e.message };
                }
              })
            );
            for (const r of resolved) {
              if (r.error) lookupErrors.push(`- ${r.id}: ${r.error}`);
              else jobs.push(r);
            }
          }
        }

        // From direct pdf_urls
        if (pdf_urls?.length) {
          for (const url of pdf_urls) {
            const filename = url.split("/").pop()?.replace(/[^a-z0-9._-]/gi, "_") || "paper.pdf";
            jobs.push({ id: url, url, filename: filename.endsWith(".pdf") ? filename : filename + ".pdf", title: url });
          }
        }

        if (!jobs.length) {
          return err(`No downloadable PDFs found.\n${lookupErrors.join("\n")}`);
        }

        // Download with concurrency 3
        const DOWNLOAD_CONCURRENCY = 3;
        const MAX_PDF_BYTES = 50 * 1024 * 1024;
        const downloaded = [];
        const downloadErrors = [];

        for (let i = 0; i < jobs.length; i += DOWNLOAD_CONCURRENCY) {
          const batch = jobs.slice(i, i + DOWNLOAD_CONCURRENCY);
          await Promise.all(
            batch.map(async (job) => {
              const filepath = join(dir, job.filename);
              if (skip_existing && existsSync(filepath)) {
                downloaded.push({ filename: job.filename, filepath, status: "skipped (exists)", sizeKb: null });
                return;
              }
              try {
                const resp = await fetch(job.url, {
                  headers: { "User-Agent": "phong-mcp/1.4 (academic-search)" },
                  signal: AbortSignal.timeout(90000),
                });
                if (!resp.ok) {
                  downloadErrors.push(`- ${job.filename}${job.access ? ` (mở nhanh: ${job.access})` : ""}: HTTP ${resp.status}`);
                  return;
                }
                const contentLength = parseInt(resp.headers.get("content-length") || "0", 10);
                if (contentLength > MAX_PDF_BYTES) {
                  downloadErrors.push(`- ${job.filename}${job.access ? ` (mở nhanh: ${job.access})` : ""}: too large (${Math.round(contentLength / 1024 / 1024)} MB)`);
                  return;
                }
                const buf = Buffer.from(await resp.arrayBuffer());
                if (buf.length > MAX_PDF_BYTES) {
                  downloadErrors.push(`- ${job.filename}${job.access ? ` (mở nhanh: ${job.access})` : ""}: too large after download (${Math.round(buf.length / 1024 / 1024)} MB)`);
                  return;
                }
                // Verify it's actually a PDF (starts with %PDF)
                if (buf.length < 4 || buf.slice(0, 4).toString() !== "%PDF") {
                  downloadErrors.push(`- ${job.filename}${job.access ? ` (mở nhanh: ${job.access})` : ""}: not a valid PDF (may require login)`);
                  return;
                }
                writeFileSync(filepath, buf);
                downloaded.push({ filename: job.filename, filepath, status: "downloaded", sizeKb: Math.round(buf.length / 1024) });
              } catch (e) {
                downloadErrors.push(`- ${job.filename}${job.access ? ` (mở nhanh: ${job.access})` : ""}: ${e.message}`);
              }
            })
          );
        }

        // Build summary
        const successCount = downloaded.filter((d) => d.status === "downloaded").length;
        const skippedCount = downloaded.filter((d) => d.status.startsWith("skipped")).length;
        const lines = [
          `# Batch PDF Download Results`,
          `**Directory**: \`${dir}\``,
          `**Total jobs**: ${jobs.length} | **Downloaded**: ${successCount} | **Skipped (exists)**: ${skippedCount} | **Failed**: ${downloadErrors.length}`,
          "",
        ];
        if (downloaded.length) {
          lines.push("## Downloaded Files");
          for (const d of downloaded) {
            const size = d.sizeKb ? ` (${d.sizeKb} KB)` : "";
            const icon = d.status === "downloaded" ? "💾" : "⏭️";
            lines.push(`${icon} \`${d.filepath}\`${size} — ${d.status}`);
          }
          lines.push("");
        }
        if (lookupErrors.length) {
          lines.push(`## Lookup Errors (${lookupErrors.length})`);
          lines.push(...lookupErrors);
          lines.push("");
        }
        if (downloadErrors.length) {
          lines.push(`## Download Errors (${downloadErrors.length})`);
          lines.push(...downloadErrors);
          lines.push("");
        }

        return ok(lines.join("\n"));
      } catch (e) {
        return err(`academic_batch_download failed: ${e.message}`);
      }
    }
  );

  // ── academic_extract (Elicit-inspired) ────────────────────────────────────────
  server.tool(
    "academic_extract",
    "Elicit-inspired structured data extraction. Given a list of paper IDs, extracts " +
    "structured dimensions from each paper's abstract and TL;DR into a comparison table. " +
    "Built-in dimensions: sample_size, study_type, outcome, method, dataset, conclusion, " +
    "limitations, year, citations, venue, open_access. Custom dimensions use keyword search. " +
    "Output formats: table (markdown), json, markdown (verbose).",
    {
      paper_ids: z.array(z.string()).min(1).max(50).describe(
        "List of paper IDs to extract from (DOI, arXiv ID, PMID, S2 ID). Max 50."
      ),
      dimensions: z.array(z.string()).min(1).max(10).optional().default(
        ["study_type", "sample_size", "outcome", "conclusion"]
      ).describe(
        "Dimensions to extract. Built-in: sample_size, study_type, outcome, method, " +
        "dataset, conclusion, limitations, year, citations, venue, open_access. " +
        "Any other string = custom keyword search in abstract."
      ),
      output_format: z.enum(["table", "json", "markdown"]).optional().default("table").describe(
        "Output format: 'table' = markdown comparison table (default), " +
        "'json' = structured JSON, 'markdown' = verbose per-paper sections."
      ),
    },
    async ({ paper_ids, dimensions, output_format }) => {
      try {
        const ck = cacheKey("academic_extract", { paper_ids: [...paper_ids].sort().join(","), dimensions: dimensions.join(","), output_format });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const resultStr = await runExtract(paper_ids, dimensions, output_format, config);
        cacheSet(ck, resultStr, TTL.PAPER);
        return ok(resultStr);
      } catch (e) {
        return err(`academic_extract failed: ${e.message}`);
      }
    }
  );

  // ── academic_evidence_check (Consensus-inspired) ──────────────────────────────
  server.tool(
    "academic_evidence_check",
    "Consensus-inspired evidence synthesis. Ask a yes/no research question and get a " +
    "verdict (Yes / No / Mixed / Unclear) backed by evidence from academic papers. " +
    "Searches multiple databases, analyses abstracts and AI TL;DRs, then aggregates " +
    "supporting, contrasting, and mixed evidence. Best for: clinical questions, " +
    "policy decisions, quick literature checks. Example: 'Does exercise improve memory?'",
    {
      question: z.string().describe(
        "Research question to evaluate. Works best as a yes/no question. " +
        "Examples: 'Does coffee improve cognitive performance?', " +
        "'Is intermittent fasting effective for weight loss?'"
      ),
      sources: z.union([
        z.array(SourceEnum),
        SourceOrPresetEnum, // a single source id ("vnulib") or a preset name
      ]).optional().describe(
        "Sources to search. Auto-selects 'biomedical' preset for clinical questions, " +
        "'default' otherwise. Override with preset name or source list."
      ),
      limit: z.number().int().min(3).max(20).optional().default(10).describe(
        "Number of papers to analyse (3-20). More = broader evidence, slower response."
      ),
      year_min: z.number().int().min(1900).max(2030).optional().describe("Filter: earliest publication year."),
      year_max: z.number().int().min(1900).max(2030).optional().describe("Filter: latest publication year."),
    },
    async ({ question, sources, limit, year_min, year_max }) => {
      try {
        const ck = cacheKey("academic_evidence_check", { question, sources, limit, year_min, year_max });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const resultStr = await runEvidenceCheck(question, sources, { limit, year_min, year_max }, config);
        cacheSet(ck, resultStr, TTL.SEARCH);
        return ok(resultStr);
      } catch (e) {
        return err(`academic_evidence_check failed: ${e.message}`);
      }
    }
  );

  // ── academic_import_file ───────────────────────────────────────────────────
  server.tool(
    "academic_import_file",
    "Import papers from exported reference files (Scopus, Web of Science, EndNote, Zotero, etc.). " +
    "Supports 6 formats: BibTeX (.bib), RIS (.ris), Scopus CSV (.csv), Web of Science Plain Text, " +
    "MEDLINE/NBIB (.nbib), and CSL-JSON (.json). Auto-detects format from extension and content. " +
    "Results are deduplicated by DOI and normalized title. Use to merge institutional database exports " +
    "into the research pipeline alongside API search results.",
    {
      file_path: z.string().describe(
        "Absolute path to the reference file to import. " +
        "Example: /Users/phongdang/Downloads/scopus_export.csv"
      ),
      format: z.enum(["auto", "bibtex", "ris", "scopus_csv", "wos", "medline", "csl_json"])
        .optional().default("auto").describe(
          "File format. 'auto' detects from extension and content. " +
          "Explicit: bibtex, ris, scopus_csv, wos (Web of Science Plain Text), " +
          "medline (NBIB/PubMed export), csl_json (Zotero/Mendeley JSON)."
        ),
      deduplicate: z.boolean().optional().default(true).describe(
        "Remove duplicate papers (by DOI, then normalized title+year). Default: true."
      ),
    },
    async ({ file_path, format, deduplicate }) => {
      try {
        // Verify file exists
        const { existsSync } = await import("fs");
        if (!existsSync(file_path)) {
          return err(`File not found: ${file_path}`);
        }

        const result = parseReferenceFile(file_path, format, deduplicate);
        const { papers, format: detected, duplicates_removed } = result;

        if (!papers.length) {
          return err(`No papers found in ${file_path} (detected format: ${detected})`);
        }

        // Format output
        const lines = [
          `# Imported ${papers.length} papers from ${detected.toUpperCase()} file`,
          `**File**: \`${file_path}\``,
          `**Format detected**: ${detected}`,
          `**Total parsed**: ${papers.length + duplicates_removed}`,
          `**Duplicates removed**: ${duplicates_removed}`,
          `**Unique papers**: ${papers.length}`,
          "",
        ];

        // Summary table
        lines.push("| # | Title | Authors | Year | DOI | Source |");
        lines.push("|---|-------|---------|------|-----|--------|");
        for (let i = 0; i < Math.min(papers.length, 50); i++) {
          const p = papers[i];
          const title = (p.title || "").slice(0, 80) + ((p.title || "").length > 80 ? "..." : "");
          const authors = (p.authors || []).slice(0, 3).join(", ") + (p.authors?.length > 3 ? " et al." : "");
          const doi = p.doi ? `[${p.doi}](https://doi.org/${p.doi})` : "—";
          lines.push(`| ${i + 1} | ${title} | ${authors} | ${p.year || "—"} | ${doi} | ${p.source} |`);
        }
        if (papers.length > 50) {
          lines.push(`| ... | *${papers.length - 50} more papers* | | | | |`);
        }
        lines.push("");

        // Stats
        const withDoi = papers.filter((p) => p.doi).length;
        const withAbstract = papers.filter((p) => p.abstract).length;
        const withPdf = papers.filter((p) => p.pdf_url).length;
        lines.push(`> 📊 **Coverage**: ${withDoi} with DOI (${Math.round(withDoi / papers.length * 100)}%), ` +
          `${withAbstract} with abstract, ${withPdf} with PDF URL`);

        return ok(lines.join("\n"));
      } catch (e) {
        return err(`academic_import_file failed: ${e.message}`);
      }
    }
  );

  // ── academic_prisma_diagram ───────────────────────────────────────────────
  server.tool(
    "academic_prisma_diagram",
    "Generate a PRISMA 2020 Flow Diagram for Systematic Reviews & Meta-Analyses (Mermaid flowchart, summary metrics, and LaTeX-ready markdown).",
    {
      title: z.string().optional().default("PRISMA 2020 Flow Diagram").describe("Title of the systematic review"),
      identification: z.record(z.string(), z.number()).optional().describe("Breakdown of identified records per database e.g. { pubmed: 120, arxiv: 80, s2: 150 }"),
      duplicates_removed: z.number().int().min(0).optional().default(0).describe("Number of duplicate records removed"),
      records_screened: z.number().int().min(0).optional().describe("Number of records screened by title/abstract"),
      records_excluded: z.number().int().min(0).optional().default(0).describe("Number of records excluded at screening"),
      reports_sought: z.number().int().min(0).optional().describe("Full-text reports sought for retrieval"),
      reports_not_retrieved: z.number().int().min(0).optional().default(0).describe("Reports not retrieved (paywalled / unavailable)"),
      reports_assessed: z.number().int().min(0).optional().describe("Full-text reports assessed for eligibility"),
      reports_excluded: z.number().int().min(0).optional().default(0).describe("Full-text reports excluded"),
      eligibility_exclusion_reasons: z.array(z.object({ reason: z.string(), count: z.number() })).optional().describe("Exclusion reasons with counts"),
      studies_included_review: z.number().int().min(0).optional().describe("Studies included in qualitative review"),
      studies_included_meta_analysis: z.number().int().min(0).optional().describe("Studies included in quantitative meta-analysis"),
    },
    async (args) => {
      try {
        const res = generatePrismaFlowDiagram(args);
        return ok(res.markdown);
      } catch (e) {
        return err(`academic_prisma_diagram failed: ${e.message}`);
      }
    }
  );

  // ── academic_meta_analysis ─────────────────────────────────────────────────
  server.tool(
    "academic_meta_analysis",
    "Run quantitative meta-analysis & clinical evidence synthesis: calculates pooled effect sizes (OR, RR, SMD, HR), 95% CIs, Fixed/Random-Effects (DerSimonian-Laird), Cochran's Q, I^2 heterogeneity, ASCII Forest Plots, plus Otto SR-grade Direct Head-to-Head PICO tables, Bucher Anchored Indirect Comparisons (ITC), Unanchored MAIC, and Evidence Network Maps.",
    {
      title: z.string().optional().default("Quantitative Meta-Analysis & Evidence Synthesis").describe("Meta-analysis or synthesis title"),
      mode: z.enum(["meta_analysis", "direct_comparison", "anchored_itc", "unanchored_maic", "evidence_network_map"]).optional().default("meta_analysis").describe("Analysis mode: meta_analysis (pooled forest plot), direct_comparison (head-to-head PICO), anchored_itc (Bucher method), unanchored_maic, or evidence_network_map"),
      measure: z.enum(["OR", "RR", "SMD", "HR"]).optional().default("OR").describe("Effect measure: OR (Odds Ratio), RR (Risk Ratio), SMD (Standardized Mean Difference), HR (Hazard Ratio)"),
      model: z.enum(["random", "fixed"]).optional().default("random").describe("Model type: random (DerSimonian-Laird) or fixed (Inverse Variance)"),
      studies: z.array(z.object({
        name: z.string().describe("Study author and year, e.g. 'Smith et al. 2023'"),
        phase: z.string().optional().describe("Trial phase, e.g. 'Phase III'"),
        e1: z.number().optional().describe("Binary: events in experimental group"),
        n1: z.number().optional().describe("Binary/Continuous: sample size in experimental group"),
        e2: z.number().optional().describe("Binary: events in control group"),
        n2: z.number().optional().describe("Binary/Continuous: sample size in control group"),
        m1: z.number().optional().describe("Continuous: mean in experimental group"),
        s1: z.number().optional().describe("Continuous: standard deviation in experimental group"),
        m2: z.number().optional().describe("Continuous: mean in control group"),
        s2: z.number().optional().describe("Continuous: standard deviation in control group"),
        estimate: z.number().optional().describe("Direct point estimate (HR, OR, RR)"),
        ciLow: z.number().optional().describe("95% CI Lower bound"),
        ciHigh: z.number().optional().describe("95% CI Upper bound"),
        pValue: z.number().optional().describe("Reported p-value"),
        rob: z.string().optional().describe("Risk of Bias summary (e.g. '🟢 Low Risk')"),
        notes: z.string().optional().describe("Study findings or subgroup notes"),
      })).optional().describe("Array of study data for pooling or direct comparison table"),
      pico: z.object({
        population: z.string().optional().describe("PICO Population"),
        intervention: z.string().optional().describe("PICO Intervention drug / asset"),
        comparator: z.string().optional().describe("PICO Active Comparator / Standard of Care"),
        outcome: z.string().optional().describe("PICO Target outcome endpoint"),
        line_of_therapy: z.string().optional().describe("Line of therapy (e.g. '1L First-line')"),
      }).optional().describe("PICO protocol specification object"),
      itc: z.object({
        trialAC: z.object({
          name: z.string().optional().describe("Study name comparing Drug A vs Anchor C"),
          intervention: z.string().optional().describe("Name of Drug A"),
          anchor: z.string().optional().describe("Name of Anchor C (e.g. Placebo / SoC)"),
          estimate: z.number().describe("Point estimate of trial AC (HR, OR, RR)"),
          ciLow: z.number().optional().describe("95% CI Lower bound"),
          ciHigh: z.number().optional().describe("95% CI Upper bound"),
        }).describe("Trial 1: Intervention A vs Anchor C"),
        trialBC: z.object({
          name: z.string().optional().describe("Study name comparing Drug B vs Anchor C"),
          intervention: z.string().optional().describe("Name of Drug B"),
          anchor: z.string().optional().describe("Name of Anchor C (e.g. Placebo / SoC)"),
          estimate: z.number().describe("Point estimate of trial BC (HR, OR, RR)"),
          ciLow: z.number().optional().describe("95% CI Lower bound"),
          ciHigh: z.number().optional().describe("95% CI Upper bound"),
        }).describe("Trial 2: Comparator B vs Anchor C"),
      }).optional().describe("Anchored Indirect Treatment Comparison input for Bucher calculation"),
      maic: z.object({
        drugA: z.string().optional().describe("Index Drug with Individual Patient Data (IPD)"),
        drugB: z.string().optional().describe("Comparator Drug with Aggregate Data (AgD)"),
        population: z.string().optional().describe("Target patient population"),
        outcome: z.string().optional().describe("Clinical endpoint (e.g. OS, PFS)"),
        measure: z.enum(["HR", "OR", "RR"]).optional().default("HR"),
        original_n: z.number().optional().describe("Original IPD sample size"),
        effective_sample_size: z.number().optional().describe("Effective Sample Size (ESS) post-weighting"),
        matched_variables: z.array(z.object({
          variable: z.string().describe("Baseline covariate name"),
          trial_a_unadjusted: z.string().optional(),
          trial_a_weighted: z.string().optional(),
          trial_b_target: z.string().optional(),
          balance_achieved: z.boolean().optional(),
        })).optional().describe("List of baseline prognostic variables matched"),
        unadjusted_effect: z.object({
          estimate: z.number(),
          ciLow: z.number(),
          ciHigh: z.number(),
        }).optional().describe("Naïve unadjusted comparison effect"),
        adjusted_effect: z.object({
          estimate: z.number(),
          ciLow: z.number(),
          ciHigh: z.number(),
        }).optional().describe("MAIC reweighted comparison effect"),
      }).optional().describe("Unanchored MAIC data and covariate balance"),
      evidence_map: z.array(z.object({
        drugA: z.string().describe("Primary asset / drug name"),
        drugB: z.string().describe("Comparator drug name"),
        comparison_type: z.enum(["direct", "anchored_itc", "unanchored_maic", "no_evidence"]).optional().default("direct"),
        anchor: z.string().optional().describe("Common anchor comparator if anchored_itc"),
        line_of_therapy: z.string().optional().default("1L"),
        finding: z.enum(["favours_asset", "favours_comparator", "inconclusive", "evidence_gap"]).optional().default("favours_asset"),
        effect_summary: z.string().optional().describe("Effect summary (e.g. 'HR 0.65 [0.50, 0.85]')"),
        notes: z.string().optional().describe("Strategic or regulatory context"),
      })).optional().describe("Comparisons array for Otto SR Evidence Network Map"),
    },
    async (args) => {
      try {
        const res = runMetaAnalysis(args);
        if (res.error) return err(res.error);
        return ok(res.markdown);
      } catch (e) {
        return err(`academic_meta_analysis failed: ${e.message}`);
      }
    }
  );

  // ── academic_risk_of_bias ──────────────────────────────────────────────────
  server.tool(
    "academic_risk_of_bias",
    "Perform structured Cochrane Risk of Bias 2.0 (RoB 2.0 for RCTs) or ROBINS-I assessment across standard quality domains with Traffic Light Plot generation.",
    {
      title: z.string().optional().default("Cochrane Risk of Bias Assessment").describe("Assessment title"),
      tool: z.enum(["rob2", "robins_i"]).optional().default("rob2").describe("Assessment framework: rob2 (Randomized Trials) or robins_i (Non-randomized studies)"),
      assessments: z.array(z.object({
        study: z.string().describe("Study name / identifier e.g. 'Johnson 2024'"),
        d1: z.enum(["low", "some_concerns", "high", "unclear"]).describe("Domain 1: Randomisation / Confounding"),
        d2: z.enum(["low", "some_concerns", "high", "unclear"]).describe("Domain 2: Deviations from interventions / Participant selection"),
        d3: z.enum(["low", "some_concerns", "high", "unclear"]).describe("Domain 3: Missing outcome data / Intervention classification"),
        d4: z.enum(["low", "some_concerns", "high", "unclear"]).describe("Domain 4: Measurement of outcome"),
        d5: z.enum(["low", "some_concerns", "high", "unclear"]).describe("Domain 5: Selection of reported result"),
        d6: z.enum(["low", "some_concerns", "high", "unclear"]).optional().describe("ROBINS-I Domain 6: Measurement of outcomes"),
        d7: z.enum(["low", "some_concerns", "high", "unclear"]).optional().describe("ROBINS-I Domain 7: Selection of reported result"),
        notes: z.string().optional().describe("Clinical / methodological rationale for ratings"),
      })).describe("List of study quality evaluations"),
    },
    async (args) => {
      try {
        const res = assessRiskOfBias(args);
        return ok(res.markdown);
      } catch (e) {
        return err(`academic_risk_of_bias failed: ${e.message}`);
      }
    }
  );

  // ── academic_extract_tables ────────────────────────────────────────────────
  server.tool(
    "academic_extract_tables",
    "Extract HTML or Markdown tables from paper text or scraped content into clean CSV, JSON Arrays, and Pandas-ready data structures.",
    {
      content: z.string().describe("Raw HTML or Markdown content containing tables"),
      max_tables: z.number().int().min(1).max(20).optional().default(10).describe("Maximum number of tables to extract"),
    },
    async (args) => {
      try {
        const tables = extractTables(args.content, args);
        if (tables.length === 0) return ok("No structured tables found in provided content.");

        let md = `## 📊 Extracted Academic Tables (${tables.length} found)\n\n`;
        for (const t of tables) {
          md += `### ${t.caption} (Index #${t.table_index})\n`;
          md += `**Headers**: \`${t.headers.join(" | ")}\` (${t.rows.length} rows)\n\n`;
          md += `\`\`\`csv\n${t.csv}\n\`\`\`\n\n`;
        }
        return ok(md);
      } catch (e) {
        return err(`academic_extract_tables failed: ${e.message}`);
      }
    }
  );

  // ── academic_obsidian_moc ──────────────────────────────────────────────────
  server.tool(
    "academic_obsidian_moc",
    "Generate a structured Map of Content (MOC) note for Obsidian Vault with hierarchical themes, tag clusters, and bidirectional [[WikiLinks]].",
    {
      topic: z.string().describe("Research topic / cluster name, e.g. 'Deep Learning in Cardiac MRI'"),
      summary: z.string().optional().describe("Executive overview of the research topic"),
      subtopics: z.array(z.string()).optional().describe("Key subtopics / themes to group papers under"),
      papers: z.array(z.object({
        title: z.string().describe("Paper title"),
        authors: z.array(z.string()).optional().describe("Author list"),
        year: z.number().optional().describe("Publication year"),
        venue: z.string().optional().describe("Journal or conference"),
        doi: z.string().optional().describe("DOI"),
        url: z.string().optional().describe("URL"),
        key_takeaway: z.string().optional().describe("1-sentence core finding or methodology"),
        tags: z.array(z.string()).optional().describe("Related topic tags"),
      })).describe("List of papers to index in MOC"),
    },
    async (args) => {
      try {
        const moc = generateObsidianMoc(args);
        return ok(`## ✅ Generated Obsidian MOC: \`${moc.filename}\` (${moc.link_count} papers linked)\n\n${moc.content}`);
      } catch (e) {
        return err(`academic_obsidian_moc failed: ${e.message}`);
      }
    }
  );


  // ── academic_fulltext ──────────────────────────────────────────────────────
  server.tool(
    "academic_fulltext",
    "Retrieve the FULL TEXT of an open-access paper from PubMed Central, not just the abstract. " +
    "Accepts a PMCID, DOI or PMID and resolves it via the NCBI ID converter. " +
    "Use this before evidence checking, data extraction or meta-analysis: reasoning from an " +
    "abstract alone is the main source of wrong conclusions in a literature pipeline. " +
    "Returns null-safe: if the paper is not in PMC, it says so rather than guessing.",
    {
      id: z.string().describe(
        'PMCID ("PMC9876543"), DOI ("10.1136/bmjopen-2022-069123") or PMID ("36921").'
      ),
      max_chars: z.number().int().min(1000).max(200000).optional().default(60000).describe(
        "Truncate the body at this many characters. Default 60000."
      ),
    },
    async ({ id: rawId, max_chars }) => {
      try {
        const ck = cacheKey("academic_fulltext", { id: rawId, max_chars });
        const cached = cacheGet(ck);
        if (cached) return ok(cached);

        const pmcid = await resolvePmcid(rawId, config);
        if (!pmcid) {
          return err(
            `No PubMed Central record for "${rawId}" — the paper has no free full text in PMC. ` +
            `Try academic_get_paper for metadata plus an OA PDF link.`
          );
        }

        const ft = await fetchPmcFullText(pmcid, config);
        if (!ft || (!ft.body && !ft.abstract)) {
          return err(`PMC record ${pmcid} returned no retrievable full text.`);
        }

        const body = ft.body || "";
        const truncated = body.length > max_chars;
        const lines = [
          `# ${ft.title || rawId}`,
          `**PMCID**: ${pmcid} — https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
          "",
        ];
        if (ft.abstract) lines.push("## Abstract", ft.abstract, "");
        if (body) {
          lines.push("## Full text", truncated ? body.slice(0, max_chars) : body);
          if (truncated) {
            lines.push("", `_[cắt bớt tại ${max_chars.toLocaleString("en-US")} ký tự — tổng ${body.length.toLocaleString("en-US")}; tăng max_chars để lấy đủ]_`);
          }
        }

        const out = lines.join("\n");
        cacheSet(ck, out, TTL.PAPER);
        return ok(out);
      } catch (e) {
        return err(`academic_fulltext failed: ${e.message}`);
      }
    }
  );

  // ── academic_trends ─────────────────────────────────────────────────────────
  server.tool(
    "academic_trends",
    "Query Google Trends public search interest (SVI 0-100), trend momentum, and breakout rising queries to expand academic literature keywords and identify clinical research gaps.",
    {
      query: z.string().optional().describe("Search keyword or biomedical topic (e.g. 'sốt xuất huyết', 'GLP-1', 'dengue fever')"),
      keyword: z.string().optional().describe("Alias for query parameter"),
      geo: z.string().optional().default("VN").describe("ISO country code (e.g. 'VN' for Vietnam, 'US' for USA, or empty string '' for worldwide)"),
      timeframe: z.string().optional().default("today 12-m").describe("Time window: 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y'"),
      hl: z.string().optional().default("vi").describe("Language code ('vi' for Vietnamese, 'en' for English)")
    },
    async ({ query, keyword, geo = "VN", timeframe = "today 12-m", hl = "vi" }) => {
      const q = query || keyword;
      if (!q) return err("academic_trends: 'query' or 'keyword' parameter is required.");
      try {
        const data = await fetchTrendsData({ keyword: q, geo, timeframe, hl });
        return ok(JSON.stringify(data, null, 2));
      } catch (e) {
        return err(`academic_trends failed for "${q}": ${e.message}`);
      }
    }
  );

  // ── academic_screening ──────────────────────────────────────────────────────
  server.tool(
    "academic_screening",
    "Manage Cochrane-standard Dual-Reviewer Blind Screening projects: create project, " +
    "record Reviewer 1 & 2 independent votes (masked), calculate Cohen's Kappa score " +
    "(inter-rater agreement reliability), and trigger AI Senior Adjudicator (GPT-5.6/Luna) " +
    "to resolve screening conflicts with Cochrane exclusion codes (E1-E7).",
    {
      action: z.enum(["create", "vote", "adjudicate", "get_report", "list", "reasons"]).describe("Screening action"),
      title: z.string().optional().describe("Project title for 'create'"),
      pico: z.object({
        population: z.string().optional(),
        intervention: z.string().optional(),
        comparator: z.string().optional(),
        outcome: z.string().optional(),
        rct_only: z.boolean().optional(),
      }).optional().describe("PICO inclusion/exclusion criteria"),
      papers: z.array(z.any()).optional().describe("List of candidate papers for 'create'"),
      project_id: z.string().optional().describe("Project ID for vote/adjudicate/get_report"),
      paper_id: z.string().optional().describe("Paper ID for 'vote'"),
      reviewer: z.union([z.literal(1), z.literal(2), z.literal("reviewer1"), z.literal("reviewer2")]).optional().describe("Reviewer seat (1 or 2)"),
      decision: z.enum(["include", "exclude", "maybe"]).optional().describe("Reviewer decision"),
      reason_code: z.string().optional().describe("Cochrane exclusion reason code (E1-E7) if excluded"),
      notes: z.string().optional().describe("Optional reviewer notes"),
    },
    async ({ action, title, pico, papers, project_id, paper_id, reviewer, decision, reason_code, notes }) => {
      try {
        if (action === "reasons") {
          return ok(JSON.stringify(COCHRANE_EXCLUSION_REASONS, null, 2));
        }
        if (action === "list") {
          return ok(JSON.stringify(listScreeningProjects(), null, 2));
        }
        if (action === "create") {
          if (!papers || papers.length === 0) return err("Action 'create' requires a non-empty 'papers' array.");
          const proj = createScreeningProject({ title, pico, papers });
          return ok(JSON.stringify({
            ok: true,
            project_id: proj.id,
            title: proj.title,
            total_papers: proj.papers.length,
            message: `Created screening project with ${proj.papers.length} candidate papers. Reviewer 1 and 2 can now cast independent blind votes.`
          }, null, 2));
        }
        if (action === "vote") {
          if (!project_id || !paper_id || !reviewer || !decision) {
            return err("Action 'vote' requires project_id, paper_id, reviewer (1 or 2), and decision ('include'|'exclude'|'maybe').");
          }
          const res = recordScreeningVote({ projectId: project_id, paperId: paper_id, reviewer, decision, reasonCode: reason_code, notes });
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === "adjudicate") {
          if (!project_id) return err("Action 'adjudicate' requires 'project_id'.");
          const res = adjudicateProjectConflicts({ projectId: project_id });
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === "get_report") {
          if (!project_id) return err("Action 'get_report' requires 'project_id'.");
          const report = getScreeningProjectReport(project_id);
          if (!report) return err(`Project ${project_id} not found.`);
          return ok(JSON.stringify(report, null, 2));
        }
        return err(`Unsupported action: ${action}`);
      } catch (e) {
        return err(`academic_screening failed: ${e.message}`);
      }
    }
  );

  // ── academic_living_review ──────────────────────────────────────────────────
  server.tool(
    "academic_living_review",
    "Living Systematic Review Auto-Monitor & Dynamic Forest Plot Suite (Elliott et al., 2014). " +
    "Register topics for continual surveillance, scan recent PubMed/PMC/VJOL literature, " +
    "detect incoming RCTs, automatically pool new trials into meta-analysis, and render live Forest Plots.",
    {
      action: z.enum(["create", "check", "list", "get_details"]).describe("Living review action"),
      topic_id: z.string().optional().describe("Topic ID for 'check' or 'get_details'"),
      title: z.string().optional().describe("Title for new living review"),
      query: z.string().optional().describe("Search query for new living review"),
      pico: z.object({
        population: z.string().optional(),
        intervention: z.string().optional(),
        comparator: z.string().optional(),
        outcome: z.string().optional(),
      }).optional().describe("Target PICO protocol"),
      measure: z.enum(["OR", "RR", "SMD", "HR"]).optional().default("OR").describe("Effect measure"),
      model: z.enum(["random", "fixed"]).optional().default("random").describe("Meta-analysis model"),
      min_quartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional().default("Q1").describe("Minimum journal quartile"),
      initial_studies: z.array(z.any()).optional().describe("Initial clinical trial records to seed Forest Plot"),
    },
    async ({ action, topic_id, title, query, pico, measure, model, min_quartile, initial_studies }) => {
      try {
        if (action === "list") {
          return ok(JSON.stringify(listLivingReviews(), null, 2));
        }
        if (action === "create") {
          if (!title || !query) return err("Action 'create' requires 'title' and 'query'.");
          const review = registerLivingReview({
            title,
            query,
            pico,
            measure,
            model,
            min_quartile,
            initialStudies: initial_studies || [],
          });
          return ok(JSON.stringify({
            ok: true,
            topic_id: review.id,
            title: review.title,
            message: `Living Systematic Review registered. Tracking PubMed/VJOL for new incoming RCTs.`
          }, null, 2));
        }
        if (action === "check") {
          if (!topic_id) return err("Action 'check' requires 'topic_id'.");
          const res = await checkLivingReviewUpdates(topic_id, config);
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === "get_details") {
          if (!topic_id) return err("Action 'get_details' requires 'topic_id'.");
          const details = getLivingReviewDetails(topic_id);
          if (!details) return err(`Topic ${topic_id} not found.`);
          return ok(JSON.stringify(details, null, 2));
        }
        return err(`Unsupported action: ${action}`);
      } catch (e) {
        return err(`academic_living_review failed: ${e.message}`);
      }
    }
  );

  // ── academic_grade_sof ──────────────────────────────────────────────────────
  server.tool(
    "academic_grade_sof",
    "GRADE Summary of Findings (SoF) Table Engine (Schünemann et al. / Cochrane Handbook). " +
    "Evaluates certainty of evidence (High, Moderate, Low, Very Low) across 5 downgrading domains " +
    "(Risk of Bias, Inconsistency, Indirectness, Imprecision, Publication Bias) and generates " +
    "publication-grade Summary of Findings tables in HTML, Markdown, and LaTeX.",
    {
      title: z.string().optional().default("GRADE Summary of Findings").describe("Review title"),
      population: z.string().optional().default("Target clinical population").describe("Population (P)"),
      intervention: z.string().optional().default("Active intervention").describe("Intervention (I)"),
      comparator: z.string().optional().default("Placebo or standard care").describe("Comparator (C)"),
      setting: z.string().optional().default("Clinical setting").describe("Setting/Context"),
      outcomes: z.array(z.object({
        outcomeName: z.string().describe("Clinical outcome name"),
        studyType: z.enum(["rct", "observational"]).optional().default("rct").describe("Study design"),
        studiesCount: z.number().int().optional().default(4).describe("Number of included studies"),
        totalPatients: z.number().int().optional().default(1000).describe("Total sample size"),
        pooledEffect: z.object({
          measure: z.enum(["OR", "RR", "SMD", "HR"]).optional().default("OR"),
          estimate: z.number().describe("Point estimate"),
          ciLow: z.number().describe("95% CI Lower bound"),
          ciHigh: z.number().describe("95% CI Upper bound"),
          pValue: z.number().optional().default(0.001),
        }).describe("Pooled effect size and 95% CI"),
        assumedRisk: z.number().optional().default(0.20).describe("Baseline risk in comparator (e.g. 0.20 for 200/1000)"),
        riskOfBias: z.enum(["not_serious", "serious", "very_serious"]).optional().default("not_serious"),
        inconsistency: z.enum(["not_serious", "serious", "very_serious"]).optional(),
        i2: z.number().optional().default(0).describe("Heterogeneity I² percentage"),
        indirectness: z.enum(["not_serious", "serious", "very_serious"]).optional().default("not_serious"),
        imprecision: z.enum(["not_serious", "serious", "very_serious"]).optional(),
        publicationBias: z.enum(["undetected", "strongly_suspected"]).optional().default("undetected"),
      })).describe("List of clinical outcomes to assess"),
    },
    async (args) => {
      try {
        const result = generateGradeSoFTable(args);
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(`academic_grade_sof failed: ${e.message}`);
      }
    }
  );

  // ── academic_publication_bias ───────────────────────────────────────────────
  server.tool(
    "academic_publication_bias",
    "Publication Bias & Small-Study Effects Suite (Egger et al., Begg & Mazumdar, Duval & Tweedie Trim-and-Fill). " +
    "Generates interactive SVG / ASCII Funnel Plots with 95% and 99% pseudo-confidence limits, " +
    "performs Egger's linear regression test and Begg's rank test for asymmetry, and imputes missing studies via Trim-and-Fill.",
    {
      title: z.string().optional().default("Publication Bias Analysis").describe("Analysis title"),
      measure: z.enum(["OR", "RR", "SMD"]).optional().default("OR").describe("Effect measure"),
      studies: z.array(z.object({
        name: z.string().describe("Study identifier/author/year"),
        e1: z.number().optional().describe("Intervention events"),
        n1: z.number().optional().describe("Intervention total"),
        e2: z.number().optional().describe("Control events"),
        n2: z.number().optional().describe("Control total"),
        effect: z.number().optional().describe("Pre-calculated log effect size"),
        se: z.number().optional().describe("Pre-calculated standard error"),
        estimate: z.number().optional().describe("Natural point estimate (e.g. OR)"),
        ciLow: z.number().optional().describe("95% CI low"),
        ciHigh: z.number().optional().describe("95% CI high"),
      })).describe("List of included trials"),
    },
    async (args) => {
      try {
        const result = analyzePublicationBias(args);
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(`academic_publication_bias failed: ${e.message}`);
      }
    }
  );

  // ── academic_equator_checklist ──────────────────────────────────────────────
  server.tool(
    "academic_equator_checklist",
    "Equator Network Reporting Guidelines Checklist Suite (PRISMA 2020 27-item, CONSORT 2010, STROBE). " +
    "Maps manuscript page and line numbers to official journal submission checklists required by Q1 editorial review.",
    {
      checklist_type: z.enum(["PRISMA_2020", "CONSORT_2010", "STROBE"]).optional().default("PRISMA_2020").describe("Target Equator guideline"),
      manuscript_title: z.string().optional().default("Clinical Research Manuscript").describe("Title of manuscript"),
      authors: z.string().optional().default("Lead Investigator et al.").describe("Author list"),
      custom_mappings: z.record(z.string()).optional().describe("Map of item number to page/line location (e.g. {'1': 'Page 1, Line 1-5', '8': 'Page 5, Line 110'})"),
    },
    async ({ checklist_type, manuscript_title, authors, custom_mappings }) => {
      try {
        const result = generateEquatorChecklistReport({
          checklistType: checklist_type,
          manuscriptTitle: manuscript_title,
          authors,
          customMappings: custom_mappings || {}
        });
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(`academic_equator_checklist failed: ${e.message}`);
      }
    }
  );

  // ── academic_protocol_rebuttal ──────────────────────────────────────────────
  server.tool(
    "academic_protocol_rebuttal",
    "PROSPERO Protocol Preregistration & Peer Review Rebuttal Response Matrix Generator. " +
    "Creates official NIHR PROSPERO CRD registration forms or 3-column Point-by-Point Response to Reviewers matrices for Q1 revision rounds.",
    {
      action: z.enum(["prospero_protocol", "rebuttal_matrix"]).describe("Action to perform"),
      protocol_data: z.object({
        title: z.string().optional(),
        affiliation: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().optional(),
        teamMembers: z.array(z.string()).optional(),
        pico: z.object({
          population: z.string().optional(),
          intervention: z.string().optional(),
          comparator: z.string().optional(),
          outcomes: z.string().optional(),
        }).optional(),
        databases: z.array(z.string()).optional(),
        searchString: z.string().optional(),
        synthesisStrategy: z.string().optional(),
      }).optional().describe("PROSPERO registration fields"),
      rebuttal_data: z.object({
        manuscriptTitle: z.string().optional(),
        journalName: z.string().optional(),
        manuscriptId: z.string().optional(),
        editorName: z.string().optional(),
        feedbackItems: z.array(z.object({
          reviewer: z.string().describe("Reviewer name / ID"),
          comment_id: z.string().describe("Comment number e.g. 1.1"),
          comment: z.string().describe("Original reviewer critique"),
          response: z.string().describe("Author response & scientific justification"),
          manuscript_changes: z.string().describe("Description of changes made"),
          location: z.string().describe("Exact manuscript location e.g. Page 4, Lines 120-135"),
        })).optional(),
      }).optional().describe("Rebuttal response fields"),
    },
    async ({ action, protocol_data, rebuttal_data }) => {
      try {
        if (action === "prospero_protocol") {
          const res = generateProsperoProtocol(protocol_data || {});
          return ok(JSON.stringify(res, null, 2));
        }
        if (action === "rebuttal_matrix") {
          const res = generateRebuttalMatrix(rebuttal_data || {});
          return ok(JSON.stringify(res, null, 2));
        }
        return err(`Unsupported action: ${action}`);
      } catch (e) {
        return err(`academic_protocol_rebuttal failed: ${e.message}`);
      }
    }
  );

  // ── academic_clinicaltrial_results ──────────────────────────────────────────
  server.tool(
    "academic_clinicaltrial_results",
    "Extract structured, machine-readable results from ClinicalTrials.gov API v2. " +
    "Directly pulls arm sample sizes (n1, n2), 2x2 mortality and adverse event tables (e1, e2), " +
    "hazard ratios, and statistical comparisons without opening or reading any PDF file.",
    {
      nct_id: z.string().describe("ClinicalTrials.gov identifier, e.g. 'NCT03057977' (EMPEROR-Reduced) or 'NCT03036124' (DAPA-HF)."),
    },
    async ({ nct_id }) => {
      try {
        const res = await fetchClinicalTrialResults(nct_id);
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return err(`academic_clinicaltrial_results failed: ${e.message}`);
      }
    }
  );

  // ── academic_pmc_tables ─────────────────────────────────────────────────────
  server.tool(
    "academic_pmc_tables",
    "Extract structured data tables and 2x2 outcome candidate rows directly from PubMed Central (PMC) full-text JATS XML. " +
    "Extracts HTML/XML <table> tags into clean JSON and CSV without reading PDF.",
    {
      pmc_id: z.string().describe("PubMed Central ID, e.g. 'PMC7444747' or '7444747'."),
    },
    async ({ pmc_id }) => {
      try {
        const res = await fetchPmcArticleTables(pmc_id);
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return err(`academic_pmc_tables failed: ${e.message}`);
      }
    }
  );

  // ── academic_robvis_plot ────────────────────────────────────────────────────
  server.tool(
    "academic_robvis_plot",
    "Generate publication-ready Cochrane Risk of Bias (RoB 2.0 & ROBINS-I) Traffic Light Plots and Stacked Summary Bar Charts (SVG vector format, robvis standard).",
    {
      assessments: z.array(z.record(z.any())).describe("List of study assessments with domain risks (d1..d5/d7, overall)."),
      tool: z.enum(["rob2", "robins_i"]).default("rob2").describe("Assessment tool: 'rob2' for RCTs or 'robins_i' for observational studies."),
      title: z.string().optional().describe("Plot title."),
    },
    async ({ assessments, tool, title }) => {
      try {
        const res = generateRobvisReport({ assessments, tool, title });
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return err(`academic_robvis_plot failed: ${e.message}`);
      }
    }
  );

  // ── academic_sensitivity_analysis ──────────────────────────────────────────
  server.tool(
    "academic_sensitivity_analysis",
    "Execute Jackknife Leave-One-Out Sensitivity Meta-Analysis to evaluate study robustness and generate Leave-One-Out Forest Plot SVG, plus Subgroup Analysis with Q_between test.",
    {
      studies: z.array(z.record(z.any())).describe("List of studies with effect sizes and CIs or 2x2 contingency data."),
      measure: z.enum(["RR", "OR", "HR", "SMD"]).default("RR").describe("Effect measure."),
      subgroup_key: z.string().optional().describe("Optional property name to run stratified subgroup analysis with Q_between test."),
      title: z.string().optional().describe("Report title."),
    },
    async ({ studies, measure, subgroup_key, title }) => {
      try {
        const looRes = runLeaveOneOutAnalysis(studies, { measure, title });
        let subgroupRes = null;
        if (subgroup_key && studies.some(s => s[subgroup_key] || s.subgroup)) {
          const studiesWithSg = studies.map(s => ({ ...s, subgroup: s[subgroup_key] || s.subgroup }));
          subgroupRes = runSubgroupAnalysis(studiesWithSg, { measure });
        }
        return ok(JSON.stringify({ leaveOneOut: looRes, subgroup: subgroupRes }, null, 2));
      } catch (e) {
        return err(`academic_sensitivity_analysis failed: ${e.message}`);
      }
    }
  );

  // ── academic_indirect_comparison ───────────────────────────────────────────
  server.tool(
    "academic_indirect_comparison",
    "Perform Bucher (1997) Anchored Indirect Treatment Comparison (ITC), direct vs indirect inconsistency test, and Network Meta-Analysis Geometry Plot SVG.",
    {
      trial_ac: z.record(z.any()).describe("Trial comparing Intervention A vs Common Anchor C: { name, intervention, anchor, estimate, ciLow, ciHigh }."),
      trial_bc: z.record(z.any()).describe("Trial comparing Intervention B vs Common Anchor C: { name, intervention, anchor, estimate, ciLow, ciHigh }."),
      direct_ab: z.record(z.any()).optional().describe("Optional direct trial of A vs B for node-splitting inconsistency test."),
      measure: z.enum(["RR", "OR", "HR"]).default("RR").describe("Effect measure."),
      network_nodes: z.array(z.record(z.any())).optional().describe("Nodes for Network Geometry SVG: [{ id, label, totalN }]."),
      network_edges: z.array(z.record(z.any())).optional().describe("Edges for Network Geometry SVG: [{ source, target, studiesCount, totalN }]."),
    },
    async ({ trial_ac, trial_bc, direct_ab, measure, network_nodes, network_edges }) => {
      try {
        const itcRes = runBucherITC(trial_ac, trial_bc, direct_ab, { measure });
        let networkSVG = null;
        if (network_nodes && network_nodes.length > 0) {
          networkSVG = generateNetworkGeometrySVG({ nodes: network_nodes, edges: network_edges });
        }
        return ok(JSON.stringify({ itc: itcRes, networkSVG }, null, 2));
      } catch (e) {
        return err(`academic_indirect_comparison failed: ${e.message}`);
      }
    }
  );

  // ── academic_imrad_synthesizer ─────────────────────────────────────────────
  server.tool(
    "academic_imrad_synthesizer",
    "Compile full academic research manuscript adhering to The Lancet & NEJM IMRaD standards, generating both structured Markdown and publication-ready LaTeX (.tex) with booktabs.",
    {
      title: z.string().describe("Manuscript title."),
      pico: z.record(z.any()).optional().describe("PICO specification: { population, intervention, comparator, outcome, design }."),
      registration: z.record(z.any()).optional().describe("Protocol registration: { platform, id }."),
      prisma_counts: z.record(z.any()).optional().describe("PRISMA flow numbers."),
      meta_analysis: z.record(z.any()).optional().describe("Primary meta-analysis results: { measure, effect, ciLow, ciHigh, pValue, iSquared }."),
      sensitivity: z.record(z.any()).optional().describe("Sensitivity analysis findings: { robustnessIndex, mostInfluentialStudy }."),
      risk_of_bias: z.record(z.any()).optional().describe("Risk of bias summary: { lowRiskCount, someConcernsCount, highRiskCount }."),
      publication_bias: z.record(z.any()).optional().describe("Publication bias results: { eggerPValue, beggPValue }."),
      grade: z.record(z.any()).optional().describe("GRADE certainty: { overallCertainty, rationale }."),
    },
    async (params) => {
      try {
        const res = synthesizeImradManuscript(params);
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return err(`academic_imrad_synthesizer failed: ${e.message}`);
      }
    }
  );
  // ── academic_journal_rank ───────────────────────────────────────────────
  server.tool(
    "academic_journal_rank",
    "Zero-token Scimago Journal Rank (SJR) & Quartile lookup. " +
    "Search by Journal Name (e.g. 'Nature Medicine', 'Lancet') or ISSN (e.g. '0028-0836'). " +
    "Returns Quartile (Q1-Q4), SJR Score, H-Index, and exact matching metadata.",
    {
      query: z.string().describe("Journal name or ISSN to look up."),
      limit: z.number().int().min(1).max(20).optional().default(5).describe("Maximum number of matching journals to return (default: 5)."),
    },
    async ({ query, limit }) => {
      try {
        const res = lookupJournalRank(query, limit);
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return err(`academic_journal_rank failed: ${e.message}`);
      }
    }
  );

  // ── academic_text_similarity ─────────────────────────────────────────────
  server.tool(
    "academic_text_similarity",
    "Zero-token text similarity scoring and title/paper deduplication. " +
    "Pass text_a & text_b to calculate Jaccard & Levenshtein similarity scores, or pass items array to deduplicate a list of titles/papers.",
    {
      text_a: z.string().optional().describe("First text to compare."),
      text_b: z.string().optional().describe("Second text to compare."),
      items: z.array(z.any()).optional().describe("List of strings or objects with 'title' to deduplicate."),
      threshold: z.number().min(0.1).max(1.0).optional().default(0.85).describe("Similarity threshold for duplicate detection (default: 0.85)."),
    },
    async ({ text_a, text_b, items, threshold }) => {
      try {
        if (text_a && text_b) {
          const res = compareTexts(text_a, text_b);
          return ok(JSON.stringify(res, null, 2));
        }
        if (items && Array.isArray(items)) {
          const res = deduplicateList(items, (x) => typeof x === "string" ? x : (x.title || x.name || JSON.stringify(x)), threshold);
          return ok(JSON.stringify(res, null, 2));
        }
        return err("Provide either text_a and text_b, or an items array to deduplicate.");
      } catch (e) {
        return err(`academic_text_similarity failed: ${e.message}`);
      }
    }
  );

}



