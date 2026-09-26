/**
 * Dimensions source plugin.
 * Free tier available — requires token from https://www.dimensions.ai/contact-us/
 * Docs: https://docs.dimensions.ai/dsl/
 *
 * Coverage: 130M+ publications, cross-domain, strong citation data.
 * Set DIMENSIONS_API_KEY in .env after registering for free access.
 */
import { fromDimensions } from "../formatter.js";

export const id = "dimensions";
export const name = "Dimensions";
export const requiresKey = true;
export const keyEnvVar = "DIMENSIONS_API_KEY";
export const domains = ["general", "cs", "bio", "medicine", "humanities", "engineering"];

const BASE = "https://app.dimensions.ai/api/dsl.json";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const apiKey = config.dimensionsApiKey;
  if (!apiKey) throw new Error("DIMENSIONS_API_KEY not set");

  // Dimensions uses DSL query language
  const yearFilter = year_min || year_max
    ? ` and year>=${year_min || 1900} and year<=${year_max || new Date().getFullYear()}`
    : "";
  const oaFilter = open_access_only ? ` and open_access_categories.name="Open Access"` : "";
  const sortMap = { citations: "times_cited desc", recency: "date_inserted desc", relevance: "" };
  const sortClause = sortMap[sort] ? ` sort by ${sortMap[sort]}` : "";

  const dsl = `search publications in title_abstract_only for "${query.replace(/"/g, '\\"')}"${yearFilter}${oaFilter} return publications[id+doi+title+authors+year+journal+times_cited+open_access+abstract+pages+volume+issue]${sortClause} limit ${Math.min(limit, 100)}`;

  const resp = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `JWT ${apiKey}` },
    body: JSON.stringify({ dsl }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Dimensions HTTP ${resp.status}`);

  const data = await resp.json();
  const pubs = data.publications || [];
  return {
    papers: pubs.map(fromDimensions),
    total: data._stats?.total_count ?? pubs.length,
  };
}

export { search as searchDimensions };
