/**
 * IEEE Xplore source plugin. Requires IEEE_API_KEY (free).
 * Register: https://developer.ieee.org/
 */
import { fromIEEE } from "../formatter.js";

export const id = "ieee";
export const name = "IEEE Xplore";
export const requiresKey = true;
export const keyEnvVar = "IEEE_API_KEY";
export const domains = ["cs", "engineering", "electronics"];

const BASE = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const apiKey = config.ieeeApiKey;
  if (!apiKey) throw new Error("IEEE_API_KEY not set");
  const sortMap = { relevance: "relevance", citations: "article_number", recency: "publication_year" };
  const params = new URLSearchParams({ apikey: apiKey, querytext: query, max_records: String(Math.min(limit, 200)), start_record: "1", sort_order: "desc", sort_field: sortMap[sort] || "relevance" });
  if (year_min) params.set("start_year", String(year_min));
  if (year_max) params.set("end_year", String(year_max));
  if (open_access_only) params.set("open_access", "True");
  const resp = await fetch(`${BASE}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!resp.ok) throw new Error(`IEEE HTTP ${resp.status}`);
  const data = await resp.json();
  return { papers: (data.articles || []).map(fromIEEE), total: data.total_records ?? 0 };
}

export { search as searchIEEE };
