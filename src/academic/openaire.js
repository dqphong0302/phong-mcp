/**
 * OpenAIRE Graph API v2 client.
 * Completely free, no API key required.
 * Covers EU-funded research, links to datasets, funders, and organizations.
 * Docs: https://graph.openaire.eu/docs/
 * API: https://api.openaire.eu/graph/v2/researchProducts
 */

import { fromOpenAIRE } from "./formatter.js";

const BASE = "https://api.openaire.eu/graph/v2";

/**
 * Search publications via OpenAIRE Graph API.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchOpenAIRE(query, opts = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;

  const url = new URL(`${BASE}/researchProducts`);
  url.searchParams.set("search", query);
  url.searchParams.set("type", "publication");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(limit, 50)));

  // Date range filters
  if (year_min) url.searchParams.set("fromPublicationDate", `${year_min}-01-01`);
  if (year_max) url.searchParams.set("toPublicationDate", `${year_max}-12-31`);

  // Open access filter
  if (open_access_only) url.searchParams.set("isInDiamondJournal", "false"); // best-effort OA signal
  // Note: OpenAIRE has bestAccessRight filter via "open_access" param
  if (open_access_only) url.searchParams.set("openAccess", "true");

  // Sort mapping
  if (sort === "citations") url.searchParams.set("sortBy", "citationCount DESC");
  if (sort === "recency") url.searchParams.set("sortBy", "publicationDate DESC");

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) throw new Error(`OpenAIRE HTTP ${resp.status}`);

  const data = await resp.json();
  const results = data.results || [];
  const total = data.header?.numFound ?? data.header?.total ?? results.length;

  return {
    papers: results.map(fromOpenAIRE),
    total,
  };
}
