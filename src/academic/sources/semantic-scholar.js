/**
 * Semantic Scholar source plugin.
 * Free; optional API key for 10x rate limit.
 * Docs: https://api.semanticscholar.org/graph/v1
 */

import { fromSemanticScholar } from "../formatter.js";

export const id = "semantic_scholar";
export const name = "Semantic Scholar";
export const requiresKey = false;
export const keyEnvVar = "SEMANTIC_SCHOLAR_API_KEY";
export const domains = ["general", "cs", "bio", "medicine"];

const BASE = "https://api.semanticscholar.org/graph/v1";
const PAPER_FIELDS = "paperId,externalIds,url,title,abstract,venue,year,citationCount,influentialCitationCount,authors,openAccessPdf,tldr,fieldsOfStudy,publicationTypes";

let _lastCallAt = 0;
async function throttle() {
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < 1200) await new Promise((r) => setTimeout(r, 1200 - elapsed));
  _lastCallAt = Date.now();
}

function makeHeaders(apiKey) {
  const h = { Accept: "application/json" };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

async function fetchWithRetry(url, init, maxRetries = 1) {
  let delay = 500;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
      if (attempt === maxRetries) return resp;
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
      const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : delay;
      console.warn(`[s2] HTTP ${resp.status} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      delay = Math.min(delay * 2, 3000);
      continue;
    }
    return resp;
  }
  return fetch(url, init);
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, offset = 0, year_min, year_max, open_access_only = false, sort = "relevance" } = opts;
  const apiKey = config.semanticScholarApiKey;
  await throttle();

  const url = new URL(`${BASE}/paper/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("fields", PAPER_FIELDS);
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  if (year_min || year_max) url.searchParams.set("year", `${year_min || 1900}-${year_max || new Date().getFullYear()}`);
  if (open_access_only) url.searchParams.set("openAccessPdf", "");
  if (sort === "citations") url.searchParams.set("sort", "citationCount");
  if (sort === "recency") url.searchParams.set("sort", "publicationDate");

  const resp = await fetchWithRetry(url, { headers: makeHeaders(apiKey), signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`Semantic Scholar HTTP ${resp.status}`);
  const data = await resp.json();
  return { papers: (data.data || []).map(fromSemanticScholar), total: data.total ?? 0 };
}

export async function getById(id, config = {}) {
  const apiKey = config.semanticScholarApiKey;
  await throttle();
  let paperId = id;
  if (/^10\.\d{4,}\//.test(id)) paperId = `DOI:${id}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(id)) paperId = `ARXIV:${id}`;
  const fields = `${PAPER_FIELDS},references`;
  const url = `${BASE}/paper/${paperId}?fields=${encodeURIComponent(fields)}`;
  const resp = await fetchWithRetry(url, { headers: makeHeaders(apiKey), signal: AbortSignal.timeout(20000) });
  if (!resp.ok) return null;
  return fromSemanticScholar(await resp.json());
}

export async function getCitationGraph(paperId, direction = "citations", limit = 20, config = {}) {
  const apiKey = config.semanticScholarApiKey;
  await throttle();
  let s2Id = paperId;
  if (/^10\.\d{4,}\//.test(paperId)) s2Id = `DOI:${paperId}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(paperId)) s2Id = `ARXIV:${paperId}`;
  const fields = "paperId,title,year,authors,citationCount,externalIds,openAccessPdf";
  const url = `${BASE}/paper/${s2Id}/${direction}?fields=${fields}&limit=${Math.min(limit, 500)}`;
  const resp = await fetchWithRetry(url, { headers: makeHeaders(apiKey), signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`S2 ${direction} HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.data || []).map((item) => item.citingPaper || item.citedPaper || item).map(fromSemanticScholar);
}

export async function getSimilarPapers(paperId, limit = 10, config = {}) {
  const apiKey = config.semanticScholarApiKey;
  await throttle();
  let s2Id = paperId;
  if (/^10\.\d{4,}\//.test(paperId)) s2Id = `DOI:${paperId}`;
  else if (/^\d{4}\.\d{4,}(v\d+)?$/.test(paperId)) s2Id = `ARXIV:${paperId}`;
  const fields = "paperId,externalIds,title,abstract,venue,year,citationCount,authors,openAccessPdf";
  const url = `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${s2Id}?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit, 100)}`;
  const resp = await fetchWithRetry(url, { headers: makeHeaders(apiKey), signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`S2 recommendations HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.recommendedPapers || []).map(fromSemanticScholar);
}

// Legacy exports
export { search as searchSemanticScholar, getById as getSemanticScholarPaper };
