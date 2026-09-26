/**
 * DOAJ source plugin. Free OA journals, no key.
 * Docs: https://doaj.org/api/v3/docs
 */
import { fromDOAJ } from "../formatter.js";

export const id = "doaj";
export const name = "DOAJ";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "medicine", "humanities"];

const BASE = "https://doaj.org/api";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;
  let q = query;
  const yf = [];
  if (year_min) yf.push(`bibjson.year:>=${year_min}`);
  if (year_max) yf.push(`bibjson.year:<=${year_max}`);
  if (yf.length) q = `(${q}) AND (${yf.join(" AND ")})`;
  const url = new URL(`${BASE}/search/articles/${encodeURIComponent(q)}`);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(limit, 100)));
  if (sort === "recency") url.searchParams.set("sort", "created_date:desc");
  const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`DOAJ HTTP ${resp.status}`);
  const data = await resp.json();
  return { papers: (data.results || []).map(fromDOAJ), total: data.total ?? 0 };
}

export { search as searchDOAJ };
