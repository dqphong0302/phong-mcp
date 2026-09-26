/**
 * Springer Nature source plugin. Requires SPRINGER_API_KEY (free).
 * Register: https://dev.springernature.com/
 */
import { fromSpringer } from "../formatter.js";

export const id = "springer";
export const name = "Springer Nature";
export const requiresKey = true;
export const keyEnvVar = "SPRINGER_API_KEY";
export const domains = ["general", "cs", "bio", "medicine", "physics"];

const BASE = "https://api.springernature.com/meta/v2/json";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const apiKey = config.springerApiKey;
  if (!apiKey) throw new Error("SPRINGER_API_KEY not set");
  let q = query;
  if (year_min) q += ` datefrom:${year_min}-01-01`;
  if (year_max) q += ` dateto:${year_max}-12-31`;
  if (open_access_only) q += " type:Journal openaccess:true";
  const url = new URL(BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("p", String(Math.min(limit, 50)));
  url.searchParams.set("s", "1");
  const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!resp.ok) throw new Error(`Springer HTTP ${resp.status}`);
  const data = await resp.json();
  const records = data.records || [];
  return { papers: records.map(fromSpringer), total: parseInt(data.result?.[0]?.total || String(records.length), 10) };
}

export { search as searchSpringer };
