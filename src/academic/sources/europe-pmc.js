/**
 * Europe PMC source plugin.
 * Free, no API key. Biomedical literature.
 * Docs: https://europepmc.org/RestfulWebService
 */
import { fromEuropePMC } from "../formatter.js";

export const id = "europe_pmc";
export const name = "Europe PMC";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "bio", "chemistry"];

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, open_access_only } = opts;
  let q = query;
  if (year_min || year_max) q += ` AND (PUB_YEAR:[${year_min || 1900} TO ${year_max || 2050}])`;
  if (open_access_only) q += " AND (OPEN_ACCESS:y)";
  const params = new URLSearchParams({ query: q, format: "json", pageSize: String(Math.min(limit, 100)), resultType: "core" });
  const resp = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`EuropePMC HTTP ${resp.status}`);
  const data = await resp.json();
  return { papers: (data.resultList?.result || []).map(fromEuropePMC), total: data.hitCount || 0 };
}

export { search as searchEuropePMC };
