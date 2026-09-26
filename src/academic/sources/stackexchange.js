/**
 * Stack Exchange / Stack Overflow API source plugin.
 * Free, no API key required.
 * Docs: https://api.stackexchange.com/docs/advanced-search
 *
 * Provides: Developer discussions, verified programming answers, code snippets, and error solutions.
 */

import { fromStackExchange } from "../formatter.js";

export const id = "stackexchange";
export const name = "Stack Overflow (Developer Q&A)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["software_engineering", "programming", "code", "debugging", "computer_science"];

const BASE_URL = "https://api.stackexchange.com/2.3/search/advanced";

/**
 * Search Stack Overflow questions and accepted solutions.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, sort = "relevance" } = opts;
  const pageSize = Math.min(limit, 20);

  const params = new URLSearchParams({
    order: "desc",
    sort: sort === "recency" ? "creation" : (sort === "citations" ? "votes" : "relevance"),
    q: query.trim(),
    site: "stackoverflow",
    filter: "withbody",
    pagesize: String(pageSize),
  });

  try {
    const resp = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const items = data.items || [];
    const papers = items.map(fromStackExchange);

    return {
      papers: papers.slice(0, limit),
      total: items.length,
    };
  } catch (err) {
    console.warn("[stackexchange] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(id, _config = {}) {
  const cleanId = id.replace(/^stackoverflow:/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = `https://api.stackexchange.com/2.3/questions/${encodeURIComponent(cleanId)}?site=stackoverflow&filter=withbody`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const item = data.items?.[0];
    return item ? fromStackExchange(item) : null;
  } catch {
    return null;
  }
}

export { search as searchStackExchange };
