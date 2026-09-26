/**
 * CORE.ac.uk source plugin. Free OA full-text. Optional API key.
 * Docs: https://api.core.ac.uk/docs/v3
 */
import { fromCORE } from "../formatter.js";

export const id = "core";
export const name = "CORE";
export const requiresKey = false;
export const keyEnvVar = "CORE_API_KEY";
export const domains = ["general", "cs", "bio", "medicine"];

const BASE = "https://api.core.ac.uk/v3";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, offset = 0, year_min, year_max, open_access_only = false } = opts;
  const h = { Accept: "application/json" };
  const apiKey = config.coreApiKey || process.env.CORE_API_KEY || "";
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  // Trailing slash matters: without it CORE answers 301, and node's fetch
  // fails on that redirect where curl follows it happily.
  const url = new URL(`${BASE}/search/works/`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("stats", "false");

  try {
    const resp = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    let results = data.results || [];
    if (year_min) results = results.filter((r) => { const y = r.yearPublished || (r.publishedDate ? parseInt(r.publishedDate.slice(0, 4), 10) : null); return !y || y >= year_min; });
    if (year_max) results = results.filter((r) => { const y = r.yearPublished || (r.publishedDate ? parseInt(r.publishedDate.slice(0, 4), 10) : null); return !y || y <= year_max; });
    if (open_access_only) results = results.filter((r) => r.downloadUrl || r.fullTextIdentifier);
    return { papers: results.map(fromCORE), total: data.totalHits ?? results.length };
  } catch {
    return { papers: [], total: 0 };
  }
}

export { search as searchCORE };
