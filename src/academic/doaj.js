/**
 * DOAJ (Directory of Open Access Journals) API search client.
 * Completely free, no API key required. All results are open access.
 * Docs: https://doaj.org/api/v3/docs
 */

import { fromDOAJ } from "./formatter.js";

const BASE = "https://doaj.org/api";

/**
 * Search academic articles via DOAJ.
 * All results are peer-reviewed open-access articles.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]  - always true for DOAJ
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchDOAJ(query, opts = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  // DOAJ supports Elasticsearch-style query syntax
  let q = query;
  const yearFilters = [];
  if (year_min) yearFilters.push(`bibjson.year:>=${year_min}`);
  if (year_max) yearFilters.push(`bibjson.year:<=${year_max}`);
  if (yearFilters.length) q = `(${q}) AND (${yearFilters.join(" AND ")})`;

  // Build sort parameter
  let sortParam = "";
  if (sort === "recency") sortParam = "created_date:desc";

  // DOAJ encodes query in URL path
  const encodedQ = encodeURIComponent(q);
  const url = new URL(`${BASE}/search/articles/${encodedQ}`);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(limit, 100)));
  if (sortParam) url.searchParams.set("sort", sortParam);

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`DOAJ HTTP ${resp.status}`);

  const data = await resp.json();
  const results = data.results || [];

  return {
    papers: results.map(fromDOAJ),
    total: data.total ?? results.length,
  };
}
