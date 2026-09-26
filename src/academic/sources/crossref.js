/**
 * Crossref source plugin.
 * Free, no key (mailto improves rate limit).
 * Docs: https://api.crossref.org/swagger-ui/index.html
 */
import { fromCrossref } from "../formatter.js";
import { isCitableWork } from "../crossref.js";

export const id = "crossref";
export const name = "Crossref";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "cs", "bio", "medicine", "humanities"];

const BASE = "https://api.crossref.org/works";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, offset = 0, year_min, year_max, open_access_only = false } = opts;
  // Over-fetch: referee reports and decision letters share the article's
  // search terms and are dropped below, so ask for headroom.
  const params = new URLSearchParams({ query, rows: String(Math.min(limit * 3, 100)) });
  if (offset > 0) params.set("offset", String(offset));
  if (config.unpaywallEmail) params.set("mailto", config.unpaywallEmail);
  const filters = [];
  if (year_min) filters.push(`from-pub-date:${year_min}-01-01`);
  if (year_max) filters.push(`until-pub-date:${year_max}-12-31`);
  if (filters.length) params.set("filter", filters.join(","));
  const resp = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`Crossref HTTP ${resp.status}`);
  const data = await resp.json();
  let papers = (data.message?.items || []).filter(isCitableWork).map(fromCrossref);
  if (open_access_only) papers = papers.filter((p) => p.pdf_url);
  return { papers: papers.slice(0, limit), total: data.message?.["total-results"] || 0 };
}

export async function getById(doi, config = {}) {
  const params = new URLSearchParams();
  if (config.unpaywallEmail) params.set("mailto", config.unpaywallEmail);
  const resp = await fetch(`${BASE}/${encodeURIComponent(doi)}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.message ? fromCrossref(data.message) : null;
}

export { search as searchCrossref };
