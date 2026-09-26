/**
 * CORE.ac.uk API v3 client.
 * Completely free; optional free API key gives 10x rate limit.
 * Register: https://core.ac.uk/services/api
 * Docs: https://api.core.ac.uk/docs/v3
 */

import { fromCORE } from "./formatter.js";

const BASE = "https://api.core.ac.uk/v3";

function makeHeaders(apiKey) {
  const h = { Accept: "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

/**
 * Search academic papers via CORE.ac.uk.
 * All indexed papers are open-access.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {string}  [opts.apiKey]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchCORE(query, opts = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, apiKey } = opts;

  const url = new URL(`${BASE}/search/works`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set("offset", "0");
  url.searchParams.set("stats", "false");

  const resp = await fetch(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) throw new Error(`CORE HTTP ${resp.status}`);

  const data = await resp.json();
  let results = data.results || [];

  // Post-filter: CORE indexes OA papers but year field may vary
  if (year_min) results = results.filter((r) => {
    const y = r.yearPublished || (r.publishedDate ? parseInt(r.publishedDate.slice(0, 4), 10) : null);
    return !y || y >= year_min;
  });
  if (year_max) results = results.filter((r) => {
    const y = r.yearPublished || (r.publishedDate ? parseInt(r.publishedDate.slice(0, 4), 10) : null);
    return !y || y <= year_max;
  });

  // CORE only indexes OA papers, but filter those with a direct download URL
  if (open_access_only) results = results.filter((r) => r.downloadUrl || r.fullTextIdentifier);

  return {
    papers: results.map(fromCORE),
    total: data.totalHits ?? results.length,
  };
}
