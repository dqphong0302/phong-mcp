/**
 * Dryad — curated, peer-reviewed research data repository (CC0), strongest in
 * ecology, evolution, biology and medicine. Free API, no key.
 * Docs: https://datadryad.org/api/v2/docs
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "dryad";
export const name = "Dryad (curated research datasets)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "biology", "ecology", "medicine", "open_science", "open_access"];

const API = "https://datadryad.org/api/v2/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({ q: query, per_page: String(Math.min(limit, 100)) });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const rows = data?._embedded?.["stash:datasets"] || [];

    const papers = [];
    for (const d of rows) {
      if (papers.length >= limit) break;
      const title = stripHtml(d.title || "");
      if (!title) continue;

      const dateRaw = d.publicationDate || d.lastModificationDate;
      const year = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const doi = String(d.identifier || "").replace(/^doi:/i, "") || null;
      papers.push({
        id: doi ? `doi:${doi}` : `dryad:${d.id}`,
        title,
        authors: (d.authors || [])
          .map((a) => [a.firstName, a.lastName].filter(Boolean).join(" ").trim())
          .filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: null,
        abstract: d.abstract ? stripHtml(d.abstract) : null,
        citation_count: null,
        pdf_url: null,
        url: doi ? `https://doi.org/${doi}` : `https://datadryad.org/dataset/${d.id}`,
        source: "dryad",
        venue: "Dryad Digital Repository",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Dryad",
        type: "dataset",
        issn: null,
        is_oa: true,
      });
    }

    return { papers, total: data?.total ?? data?.count ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[dryad] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchDryad };
