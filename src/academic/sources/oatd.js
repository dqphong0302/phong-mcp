/**
 * Open Access Theses and Dissertations (OATD) Source Plugin.
 * Free, no API key required.
 *
 * Targets PhD dissertations, doctoral theses, and master's dissertations worldwide.
 * Powered via OpenAlex dissertation-type filtering.
 */

import { fromDissertation } from "../formatter.js";

export const id = "oatd";
export const name = "OATD (Theses & Dissertations)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["theses", "dissertations", "doctoral_research", "academic_degrees"];

const OPENALEX_API = "https://api.openalex.org/works";

/**
 * Search PhD dissertations and master's theses.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;
  const perPage = Math.min(limit, 25);

  const filters = ["type:dissertation"];
  if (year_min || year_max) {
    filters.push(`publication_year:${year_min || 2010}-${year_max || new Date().getFullYear()}`);
  }

  const params = new URLSearchParams({
    search: query.trim(),
    filter: filters.join(","),
    per_page: String(perPage),
  });

  if (sort === "citations") params.set("sort", "cited_by_count:desc");
  else if (sort === "recency") params.set("sort", "publication_date:desc");
  else params.set("sort", "relevance_score:desc");

  try {
    const resp = await fetch(`${OPENALEX_API}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0 (mailto:phongdang@home-server.local)",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const results = data.results || [];
    const papers = results.map(fromDissertation);

    return {
      papers: papers.slice(0, limit),
      total: data.meta?.count || papers.length,
    };
  } catch (err) {
    console.warn("[oatd] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchOatd };
