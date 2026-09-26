/**
 * Semantic Scholar API client.
 * Free; register at semanticscholar.org/product/api for 10 req/s (vs 1 req/s unauthenticated).
 * Docs: https://api.semanticscholar.org/graph/v1
 */

import { fromSemanticScholar } from "./formatter.js";

const BASE = "https://api.semanticscholar.org/graph/v1";

// Token-bucket throttle: 1.2s between requests (safe margin above 1 req/s free tier limit)
let _lastCallAt = 0;

async function throttle(_apiKey) {
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < 1200) await new Promise((r) => setTimeout(r, 1200 - elapsed));
  _lastCallAt = Date.now();
}

/**
 * Fetch with exponential backoff on HTTP 429 / 5xx.
 * @param {string|URL} url
 * @param {RequestInit} init
 * @param {number} [maxRetries=3]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init, maxRetries = 3) {
  let delay = 2000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
      if (attempt === maxRetries) return resp; // return final response to let caller handle
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : delay;
      console.warn(`[s2] HTTP ${resp.status} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      delay = Math.min(delay * 2, 30000); // cap at 30s
      continue;
    }
    return resp;
  }
  // unreachable but satisfies TS
  return fetch(url, init);
}

function makeHeaders(apiKey) {
  const h = { Accept: "application/json" };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

const PAPER_FIELDS =
  "paperId,externalIds,url,title,abstract,venue,year,citationCount,influentialCitationCount,authors,openAccessPdf,tldr";

/**
 * Search papers via Semantic Scholar.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {string}  [opts.apiKey]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchSemanticScholar(query, opts = {}) {
  const { limit = 10, apiKey, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;

  await throttle(apiKey);

  const url = new URL(`${BASE}/paper/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("fields", PAPER_FIELDS);
  url.searchParams.set("limit", String(Math.min(limit, 100)));

  if (year_min || year_max) {
    const from = year_min || 1900;
    const to = year_max || new Date().getFullYear();
    url.searchParams.set("year", `${from}-${to}`);
  }

  if (open_access_only) {
    url.searchParams.set("openAccessPdf", "");
  }

  // Sort mapping
  if (sort === "citations") url.searchParams.set("sort", "citationCount");
  if (sort === "recency") url.searchParams.set("sort", "publicationDate");

  const resp = await fetchWithRetry(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`Semantic Scholar HTTP ${resp.status}`);

  const data = await resp.json();
  const papers = (data.data || []).map(fromSemanticScholar);

  return {
    papers,
    total: data.total ?? papers.length,
  };
}

/**
 * Get full paper details by DOI, arXiv ID, or S2 paperId.
 *
 * @param {string} id  - "10.xxx/...", "2301.12345" (arXiv), or S2 paperId (40-char hex)
 * @param {string} [apiKey]
 * @returns {Promise<import("./formatter.js").AcademicPaper|null>}
 */
export async function getSemanticScholarPaper(id, apiKey) {
  await throttle(apiKey);

  // S2 understands DOI:, ARXIV: (or arXiv:) prefixes
  // IMPORTANT: do NOT use encodeURIComponent — colons are valid in URL paths
  // and S2 does not accept %3A.
  let paperId = id;
  if (/^10\.\d{4,}\//.test(id)) paperId = `DOI:${id}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(id)) paperId = `ARXIV:${id}`;

  const fields = `${PAPER_FIELDS},references`;
  const url = `${BASE}/paper/${paperId}?fields=${encodeURIComponent(fields)}`;

  const resp = await fetchWithRetry(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) return null;
  const paper = await resp.json();
  return fromSemanticScholar(paper);
}

/**
 * Get citations or references of a paper.
 *
 * @param {string} paperId  - S2 paper ID, DOI (10.xxx/...), or arXiv ID (2301.12345)
 * @param {"citations"|"references"} direction
 * @param {number} limit
 * @param {string} [apiKey]
 * @returns {Promise<import("./formatter.js").AcademicPaper[]>}
 */
export async function getCitationGraph(paperId, direction = "citations", limit = 20, apiKey) {
  await throttle(apiKey);

  // Build S2-compatible ID with uppercase prefixes.
  // IMPORTANT: do NOT use encodeURIComponent — colons are valid in URL paths
  // and S2 does not accept %3A (returns 400 Bad Request).
  let s2Id = paperId;
  if (/^10\.\d{4,}\//.test(paperId)) s2Id = `DOI:${paperId}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(paperId)) s2Id = `ARXIV:${paperId}`;

  // 'tldr' is only available in /paper/{id}, NOT in /citations or /references endpoints
  const fields = "paperId,title,year,authors,citationCount,externalIds,openAccessPdf";
  const url = `${BASE}/paper/${s2Id}/${direction}?fields=${fields}&limit=${Math.min(limit, 500)}`;

  const resp = await fetchWithRetry(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Semantic Scholar ${direction} HTTP ${resp.status}`);

  const data = await resp.json();
  const items = data.data || [];

  return items
    .map((item) => item.citingPaper || item.citedPaper || item)
    .map(fromSemanticScholar);
}

/**
 * Get recommended (similar) papers using S2 Recommendations API.
 * Uses a separate base URL: api.semanticscholar.org/recommendations/v1
 *
 * @param {string} paperId  - DOI (10.xxx/...), arXiv ID (2301.12345), or S2 40-char hex
 * @param {number} [limit=10]
 * @param {string} [apiKey]
 * @returns {Promise<import("./formatter.js").AcademicPaper[]>}
 */
export async function getSimilarPapers(paperId, limit = 10, apiKey) {
  await throttle(apiKey);

  // Build S2-compatible ID with uppercase prefixes (no encodeURIComponent — colons valid in path)
  let s2Id = paperId;
  if (/^10\.\d{4,}\//.test(paperId)) s2Id = `DOI:${paperId}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(paperId)) s2Id = `ARXIV:${paperId}`;

  const fields = "paperId,externalIds,title,abstract,venue,year,citationCount,authors,openAccessPdf";
  const url =
    `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${s2Id}` +
    `?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit, 100)}`;

  const resp = await fetchWithRetry(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`Semantic Scholar recommendations HTTP ${resp.status}`);

  const data = await resp.json();
  return (data.recommendedPapers || []).map(fromSemanticScholar);
}
