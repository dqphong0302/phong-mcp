/**
 * Figshare — OA repository for datasets, figures, posters and preprints;
 * also the platform behind TechRxiv and many institutional repositories.
 * Free public API, no key.
 * Docs: https://docs.figshare.com/
 */

import { withTimeout } from "./_ojs.js";

export const id = "figshare";
export const name = "Figshare (datasets, figures, TechRxiv preprints)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "preprints", "engineering", "open_science", "open_access"];

const API = "https://api.figshare.com/v2/articles/search";

const TYPE_MAP = {
  dataset: "dataset", software: "software", preprint: "preprint",
  journal_contribution: "article", conference_contribution: "conference", thesis: "dissertation",
};

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  const body = {
    search_for: query,
    page_size: Math.min(limit, 100),
    order: "published_date",
    order_direction: "desc",
  };
  if (year_min) body.published_since = `${year_min}-01-01`;
  if (year_max) body.published_before = `${year_max}-12-31`;

  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const rows = await resp.json();

    const papers = (Array.isArray(rows) ? rows : []).slice(0, limit).map((r) => {
      const year = r.published_date ? parseInt(String(r.published_date).slice(0, 4), 10) : null;
      return {
        id: r.doi ? `doi:${r.doi}` : `figshare:${r.id}`,
        title: r.title || "",
        authors: (r.authors || []).map((a) => a.full_name).filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi: r.doi || null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: null,
        url: r.url_public_html || r.url || (r.doi ? `https://doi.org/${r.doi}` : null),
        source: "figshare",
        venue: "Figshare",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Figshare",
        type: TYPE_MAP[r.defined_type_name] || "other",
        issn: null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[figshare] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchFigshare };
