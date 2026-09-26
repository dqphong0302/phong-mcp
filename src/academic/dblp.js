/**
 * DBLP computer science bibliography search client.
 * Completely free, no API key required.
 * Docs: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
 */

import { fromDBLP } from "./formatter.js";

const BASE = "https://dblp.org/search/publ/api";

/**
 * Search computer science papers via DBLP.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchDBLP(query, opts = {}) {
  const { limit = 10, year_min, year_max } = opts;

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");
  params.set("h", String(Math.min(limit, 1000)));

  const res = await fetch(`${BASE}?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DBLP error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const hits = data.result?.hits?.hit || [];

  let papers = hits
    .map((hit) => fromDBLP(hit.info))
    .filter(Boolean);

  // DBLP simple API doesn't natively filter by year, so we post-filter
  if (year_min) papers = papers.filter((p) => !p.year || p.year >= year_min);
  if (year_max) papers = papers.filter((p) => !p.year || p.year <= year_max);

  return { papers, total: parseInt(data.result?.hits?.["@total"], 10) || 0 };
}
