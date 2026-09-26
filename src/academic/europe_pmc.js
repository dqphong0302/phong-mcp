/**
 * Europe PMC API client for biomedical literature.
 * Completely free, no API key required.
 * Docs: https://europepmc.org/RestfulWebService
 */

import { fromEuropePMC } from "./formatter.js";

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

/**
 * Search papers via Europe PMC.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchEuropePMC(query, opts = {}) {
  const { limit = 10, year_min, year_max, open_access_only } = opts;

  let q = query;
  if (year_min || year_max) {
    const yMin = year_min || 1900;
    const yMax = year_max || 2050;
    q += ` AND (PUB_YEAR:[${yMin} TO ${yMax}])`;
  }
  if (open_access_only) {
    q += ` AND (OPEN_ACCESS:y)`;
  }

  const params = new URLSearchParams();
  params.set("query", q);
  params.set("format", "json");
  params.set("pageSize", String(Math.min(limit, 100)));
  params.set("resultType", "core");

  const res = await fetch(`${BASE}?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Europe PMC error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const results = data.resultList?.result || [];

  return {
    papers: results.map(fromEuropePMC),
    total: data.hitCount || 0,
  };
}
