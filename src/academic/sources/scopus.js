/**
 * Scopus source plugin. Requires SCOPUS_API_KEY (free for researchers).
 * Register: https://dev.elsevier.com/
 */
import { fromScopus } from "../formatter.js";

export const id = "scopus";
export const name = "Scopus";
export const requiresKey = true;
export const keyEnvVar = "SCOPUS_API_KEY";
export const domains = ["general", "cs", "bio", "medicine", "engineering"];

const BASE = "https://api.elsevier.com/content/search/scopus";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const apiKey = config.scopusApiKey;
  if (!apiKey) throw new Error("SCOPUS_API_KEY not set");
  const sortMap = { relevance: "relevancy", citations: "citedby-count desc", recency: "coverDate desc" };
  const params = new URLSearchParams({
    query: `TITLE-ABS-KEY(${query})`,
    apiKey,
    count: String(Math.min(limit, 200)),
    start: "0",
    sort: sortMap[sort] || "relevancy",
    field: "dc:title,dc:creator,prism:publicationName,prism:coverDate,prism:doi,citedby-count,openaccess,dc:description,prism:volume,prism:issueIdentifier,prism:pageRange,prism:issn,subtypeDescription,author,dc:identifier,prism:url",
  });
  if (year_min || year_max) params.set("date", `${year_min || 1900}-${year_max || new Date().getFullYear()}`);
  if (open_access_only) params.set("openAccess", "true");
  const resp = await fetch(`${BASE}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!resp.ok) throw new Error(`Scopus HTTP ${resp.status}`);
  const data = await resp.json();
  const entries = data["search-results"]?.entry || [];
  return { papers: entries.map(fromScopus), total: parseInt(data["search-results"]?.["opensearch:totalResults"] || "0", 10) };
}

export { search as searchScopus };
