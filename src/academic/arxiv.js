/**
 * arXiv Atom/XML API client.
 * Completely free, no API key required.
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 */

import { fromArxiv } from "./formatter.js";

const BASE = "http://export.arxiv.org/api/query";

// arXiv asks for ≥3s between requests
let _lastCallAt = 0;
async function throttle() {
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < 3100) await new Promise((r) => setTimeout(r, 3100 - elapsed));
  _lastCallAt = Date.now();
}

/**
 * Parse arXiv Atom XML response into plain objects.
 * Uses basic regex parsing to avoid xml2js dependency.
 *
 * @param {string} xml
 * @returns {Object[]}
 */
function parseArxivXml(xml) {
  const entries = [];
  // Split on <entry> … </entry>
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
    };

    const id = get("id");
    const title = get("title").replace(/\s+/g, " ");
    const summary = get("summary").replace(/\s+/g, " ");
    const published = get("published");

    // Multiple authors
    const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g;
    const authors = [];
    let am;
    while ((am = authorRe.exec(block)) !== null) authors.push(am[1].trim());

    entries.push({ id, title, summary, published, author: authors });
  }
  return entries;
}

/**
 * Build arXiv search query with category support.
 * @param {string} query  - plain text query
 * @param {string[]} categories  - e.g. ["cs.AI", "cs.LG"]
 */
function buildSearchQuery(query, categories) {
  const termPart = `all:${query}`;
  if (!categories || !categories.length) return termPart;
  const catPart = categories.map((c) => `cat:${c}`).join("+OR+");
  return `${termPart}+AND+(${catPart})`;
}

/**
 * Search arXiv preprints.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}   [opts.limit=10]
 * @param {string[]} [opts.categories]   - e.g. ["cs.AI", "cs.LG", "stat.ML"]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchArxiv(query, opts = {}) {
  const { limit = 10, categories, sort = "relevance" } = opts;

  await throttle();

  const sortByMap = {
    relevance: "relevance",
    recency: "submittedDate",
    citations: "relevance", // arXiv has no citation sort
  };

  const params = new URLSearchParams({
    search_query: buildSearchQuery(query, categories),
    start: "0",
    max_results: String(Math.min(limit, 50)),
    sortBy: sortByMap[sort] || "relevance",
    sortOrder: "descending",
  });

  const url = `${BASE}?${params}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });

  if (!resp.ok) throw new Error(`arXiv HTTP ${resp.status}`);

  const xml = await resp.text();

  // Extract total results from opensearch:totalResults
  const totalMatch = /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i.exec(xml);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  const entries = parseArxivXml(xml);
  return {
    papers: entries.map(fromArxiv),
    total,
  };
}

/**
 * Get arXiv paper by arXiv ID.
 *
 * @param {string} arxivId  - e.g. "2301.12345" or "cs.AI/0504004"
 * @returns {Promise<import("./formatter.js").AcademicPaper|null>}
 */
export async function getArxivPaper(arxivId) {
  await throttle();

  const cleanId = arxivId.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const url = `${BASE}?id_list=${encodeURIComponent(cleanId)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });

  if (!resp.ok) return null;

  const xml = await resp.text();
  const entries = parseArxivXml(xml);
  return entries.length > 0 ? fromArxiv(entries[0]) : null;
}
