/**
 * IEEE Xplore Digital Library API client.
 * Free API key required: https://developer.ieee.org/
 * Docs: https://developer.ieee.org/docs/read/IEEE_Xplore_API_Overview
 *
 * Covers IEEE journals, transactions, magazines, and conference proceedings.
 * Register at: https://developer.ieee.org/ → "Register"
 */

import { fromIEEE } from "./formatter.js";

const BASE = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

/**
 * Search papers via IEEE Xplore API.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {string}  [opts.apiKey]       - Required: IEEE_API_KEY env var
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchIEEE(query, opts = {}) {
  const {
    limit = 10,
    apiKey,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
  } = opts;

  if (!apiKey) throw new Error("IEEE Xplore API key required. Set IEEE_API_KEY env var (free: https://developer.ieee.org/)");

  // IEEE sort field mapping
  const sortFieldMap = {
    relevance: "relevance",
    citations: "article_number", // IEEE API doesn't expose citation sort directly
    recency: "publication_year",
  };

  const params = new URLSearchParams({
    apikey: apiKey,
    querytext: query,
    max_records: String(Math.min(limit, 200)),
    start_record: "1",
    sort_order: "desc",
    sort_field: sortFieldMap[sort] || "relevance",
  });

  if (year_min) params.set("start_year", String(year_min));
  if (year_max) params.set("end_year", String(year_max));
  if (open_access_only) params.set("open_access", "True");

  const resp = await fetch(`${BASE}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`IEEE Xplore HTTP ${resp.status}: ${msg.slice(0, 200)}`);
  }

  const data = await resp.json();
  const articles = data.articles || [];

  return {
    papers: articles.map(fromIEEE),
    total: data.total_records ?? articles.length,
  };
}
