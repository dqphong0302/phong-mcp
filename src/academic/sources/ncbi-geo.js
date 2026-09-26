/**
 * NCBI GEO (Gene Expression Omnibus) — functional genomics datasets and
 * series. Queried through E-utilities (db=gds). Free, no key; NCBI_API_KEY
 * raises the rate limit when present.
 * Docs: https://www.ncbi.nlm.nih.gov/geo/info/download.html
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "ncbi_geo";
export const name = "NCBI GEO (Gene Expression Omnibus datasets)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "genomics", "bioinformatics", "biomedical", "open_access"];

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function keyParams(config) {
  const k = config.ncbiApiKey || process.env.NCBI_API_KEY;
  const p = { tool: "academic-search-mcp" };
  if (k) p.api_key = k;
  return p;
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  let term = query;
  if (year_min || year_max) term += ` AND ("${year_min || 1990}"[PDAT] : "${year_max || 3000}"[PDAT])`;

  try {
    const sParams = new URLSearchParams({
      db: "gds", term, retmode: "json", retmax: String(Math.min(limit, 100)), ...keyParams(config),
    });
    const sResp = await fetch(`${EUTILS}/esearch.fcgi?${sParams}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!sResp.ok) return { papers: [], total: 0 };
    const sData = await sResp.json();
    const ids = sData?.esearchresult?.idlist || [];
    const total = parseInt(sData?.esearchresult?.count, 10);
    if (!ids.length) return { papers: [], total: Number.isFinite(total) ? total : 0 };

    const dParams = new URLSearchParams({ db: "gds", id: ids.join(","), retmode: "json", ...keyParams(config) });
    const dResp = await fetch(`${EUTILS}/esummary.fcgi?${dParams}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!dResp.ok) return { papers: [], total: Number.isFinite(total) ? total : 0 };
    const result = (await dResp.json())?.result || {};

    const papers = [];
    for (const uid of ids) {
      const r = result[uid];
      if (!r || !r.title) continue;
      const acc = r.accession || null;
      const year = r.pdat ? parseInt(String(r.pdat).slice(0, 4), 10) : null;
      papers.push({
        id: `ncbi_geo:${acc || uid}`,
        title: stripHtml(r.title),
        authors: [],
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract: r.summary ? stripHtml(r.summary) : null,
        citation_count: null,
        pdf_url: null,
        url: acc ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${acc}` : null,
        source: "ncbi_geo",
        venue: [r.gdstype, r.taxon].filter(Boolean).join(" — ") || "NCBI Gene Expression Omnibus",
        volume: null,
        issue: null,
        pages: null,
        publisher: "National Center for Biotechnology Information (NCBI)",
        type: "dataset",
        issn: null,
        is_oa: true,
        n_samples: r.n_samples ?? null,
      });
      if (papers.length >= limit) break;
    }

    return { papers, total: Number.isFinite(total) ? total : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[ncbi_geo] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchNcbiGeo };
