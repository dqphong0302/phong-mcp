/**
 * OpenAlex source plugin.
 * Free, no API key required (email improves rate limit via polite pool).
 * Docs: https://docs.openalex.org/
 */

import { fromOpenAlex } from "../formatter.js";

export const id = "openalex";
export const name = "OpenAlex";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "cs", "bio", "medicine", "humanities"];

const BASE = "https://api.openalex.org/works";

/**
 * @param {string} query
 * @param {Object} opts
 * @param {Object} config
 * @returns {Promise<{papers, total}>}
 */
export async function search(query, opts = {}, config = {}) {
  const { limit = 10, page = 1, offset = 0, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const pageNum = offset > 0 ? Math.floor(offset / limit) + 1 : page;

  const params = new URLSearchParams();
  params.set("search", query);
  params.set("per-page", String(Math.min(limit, 200)));
  params.set("page", String(pageNum));
  if (config.unpaywallEmail) params.set("mailto", config.unpaywallEmail);

  const filters = [];
  if (year_min) filters.push(`publication_year:>${year_min - 1}`);
  if (year_max) filters.push(`publication_year:<${year_max + 1}`);
  if (open_access_only) filters.push("is_oa:true");
  if (filters.length) params.set("filter", filters.join(","));

  const sortMap = { relevance: "relevance_score:desc", citations: "cited_by_count:desc", recency: "publication_date:desc" };
  if (sortMap[sort]) params.set("sort", sortMap[sort]);

  const resp = await fetch(`${BASE}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`OpenAlex HTTP ${resp.status}`);

  const data = await resp.json();
  return {
    papers: (data.results || []).map(fromOpenAlex),
    total: data.meta?.count ?? 0,
  };
}

/**
 * Get a single work by DOI.
 * @param {string} doi
 * @param {Object} config
 * @returns {Promise<import("../formatter.js").AcademicPaper|null>}
 */
export async function getById(doi, config = {}) {
  const params = new URLSearchParams();
  if (config.unpaywallEmail) params.set("mailto", config.unpaywallEmail);
  const resp = await fetch(`${BASE}/doi:${encodeURIComponent(doi)}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return fromOpenAlex(data);
}

// Legacy export for backward compatibility
export { getById as getOpenAlexWork };
export async function searchOpenAlex(query, opts = {}) {
  return search(query, opts, { unpaywallEmail: opts.email });
}
