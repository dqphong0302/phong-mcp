/**
 * arXiv source plugin.
 * Free, no API key. Rate limit: ≥3s between requests.
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 */

import { fromArxiv } from "../formatter.js";

export const id = "arxiv";
export const name = "arXiv";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["cs", "physics", "math", "bio", "economics"];

const BASE = "http://export.arxiv.org/api/query";
let _lastCallAt = 0;

async function throttle() {
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < 3100) await new Promise((r) => setTimeout(r, 3100 - elapsed));
  _lastCallAt = Date.now();
}

function parseArxivXml(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
    };
    const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g;
    const authors = [];
    let am;
    while ((am = authorRe.exec(block)) !== null) authors.push(am[1].trim());
    entries.push({ id: get("id"), title: get("title").replace(/\s+/g, " "), summary: get("summary").replace(/\s+/g, " "), published: get("published"), author: authors });
  }
  return entries;
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (resp.status === 429) {
      const delay = (attempt + 1) * 4000; // 4s, 8s, 12s
      console.warn(`[arxiv] Rate limited (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return resp;
  }
  throw new Error("arXiv HTTP 429 — rate limit exceeded after retries");
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, categories, sort = "relevance" } = opts;
  await throttle();
  const termPart = `all:${query}`;
  const catPart = categories?.length ? `+AND+(${categories.map((c) => `cat:${c}`).join("+OR+")})` : "";
  const sortByMap = { relevance: "relevance", recency: "submittedDate", citations: "relevance" };
  const params = new URLSearchParams({
    search_query: termPart + catPart,
    start: "0",
    max_results: String(Math.min(limit, 50)),
    sortBy: sortByMap[sort] || "relevance",
    sortOrder: "descending",
  });
  const resp = await fetchWithRetry(`${BASE}?${params}`);
  if (!resp.ok) throw new Error(`arXiv HTTP ${resp.status}`);
  const xml = await resp.text();
  const totalMatch = /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i.exec(xml);
  return { papers: parseArxivXml(xml).map(fromArxiv), total: totalMatch ? parseInt(totalMatch[1], 10) : 0 };
}

export async function getById(arxivId, _config = {}) {
  await throttle();
  const cleanId = arxivId.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const resp = await fetch(`${BASE}?id_list=${encodeURIComponent(cleanId)}`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) return null;
  const entries = parseArxivXml(await resp.text());
  return entries.length > 0 ? fromArxiv(entries[0]) : null;
}

// Legacy exports
export { search as searchArxiv, getById as getArxivPaper };
