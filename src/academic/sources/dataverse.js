/**
 * Harvard Dataverse Search API source plugin.
 * Free, no API key required.
 * Docs: https://guides.dataverse.org/en/latest/api/search.html
 *
 * Provides: Open science research replication datasets and raw study files.
 */

import { fromDataverse } from "../formatter.js";

export const id = "dataverse";
export const name = "Harvard Dataverse (Research Data)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "open_science", "research_data", "social_sciences", "medicine"];

const BASE_URL = "https://dataverse.harvard.edu/api/search";

/**
 * Search Harvard Dataverse datasets.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, sort = "relevance" } = opts;
  const perPage = Math.min(limit, 20);

  const params = new URLSearchParams({
    q: query.trim(),
    type: "dataset",
    per_page: String(perPage),
  });

  if (sort === "recency") params.set("sort", "publication_date");

  try {
    const resp = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const items = data.data?.items || [];
    const papers = items.map(fromDataverse);

    return {
      papers: papers.slice(0, limit),
      total: data.data?.total_count || papers.length,
    };
  } catch (err) {
    console.warn("[dataverse] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchDataverse };
