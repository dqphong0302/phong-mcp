/**
 * OpenAIRE source plugin. EU-funded research, free, no key.
 * Docs: https://graph.openaire.eu/docs/
 */
import { fromOpenAIRE } from "../formatter.js";

export const id = "openaire";
export const name = "OpenAIRE";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "eu_research"];

const BASE = "https://api.openaire.eu/graph/v2";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const url = new URL(`${BASE}/researchProducts`);
  url.searchParams.set("search", query);
  url.searchParams.set("type", "publication");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(limit, 50)));
  if (year_min) url.searchParams.set("fromPublicationDate", `${year_min}-01-01`);
  if (year_max) url.searchParams.set("toPublicationDate", `${year_max}-12-31`);
  if (open_access_only) url.searchParams.set("openAccess", "true");
  if (sort === "citations") url.searchParams.set("sortBy", "citationCount DESC");
  if (sort === "recency") url.searchParams.set("sortBy", "publicationDate DESC");
  const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!resp.ok) throw new Error(`OpenAIRE HTTP ${resp.status}`);
  const data = await resp.json();
  const results = data.results || [];
  return { papers: results.map(fromOpenAIRE), total: data.header?.numFound ?? data.header?.total ?? results.length };
}

export { search as searchOpenAIRE };
