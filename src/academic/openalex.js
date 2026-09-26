/**
 * OpenAlex API client for academic paper search.
 * Completely free, no API key required (polite pool = email in User-Agent).
 * Docs: https://docs.openalex.org/api-entities/works/search-works
 */

import { fromOpenAlex } from "./formatter.js";

const BASE = "https://api.openalex.org";

function makeHeaders(email) {
  return {
    "User-Agent": `phong-mcp/1.4 (mailto:${email || "research@example.com"})`,
    Accept: "application/json",
  };
}

/**
 * Search papers via OpenAlex.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @param {string}  [opts.email]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchOpenAlex(query, opts = {}) {
  const {
    limit = 10,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
    email,
  } = opts;

  const url = new URL(`${BASE}/works`);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(Math.min(limit, 25)));

  // Build filter
  const filters = [];
  if (year_min || year_max) {
    if (year_min && year_max) {
      filters.push(`publication_year:${year_min}-${year_max}`);
    } else if (year_min) {
      filters.push(`publication_year:>${year_min - 1}`);
    } else {
      filters.push(`publication_year:<${year_max + 1}`);
    }
  }
  if (open_access_only) filters.push("open_access.is_oa:true");
  if (filters.length) url.searchParams.set("filter", filters.join(","));

  // Sort — for citations, keep relevance as primary OpenAlex sort; academic_search will
  // re-sort the merged results by citation_count locally after dedup.
  const sortMap = {
    relevance: "relevance_score:desc",
    citations: "relevance_score:desc",  // local re-sort applied after fetch
    recency: "publication_year:desc",
  };
  url.searchParams.set("sort", sortMap[sort] || "relevance_score:desc");

  // Select only needed fields for efficiency — note: 'title' is NOT a valid OpenAlex field, use 'display_name'
  url.searchParams.set(
    "select",
    "id,doi,display_name,authorships,publication_year,cited_by_count,abstract_inverted_index,open_access,primary_location"
  );

  if (email) url.searchParams.set("mailto", email);

  const resp = await fetch(url, {
    headers: makeHeaders(email),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`OpenAlex HTTP ${resp.status}`);

  const data = await resp.json();
  const works = data.results || [];
  const total = data.meta?.count ?? works.length;

  return {
    papers: works.map(fromOpenAlex),
    total,
  };
}

/**
 * Get a single paper by DOI or OpenAlex Work ID.
 *
 * @param {string} id  - DOI (10.xxx/...) or OpenAlex work ID (W...)
 * @param {string} [email]
 * @returns {Promise<import("./formatter.js").AcademicPaper|null>}
 */
export async function getOpenAlexWork(id, email) {
  // Normalize DOI → OpenAlex URL format
  const workId = id.startsWith("W") ? id : `doi:${id}`;
  const url = `${BASE}/works/${encodeURIComponent(workId)}?select=id,doi,title,display_name,authorships,publication_year,cited_by_count,abstract_inverted_index,open_access,primary_location`;

  const resp = await fetch(url, {
    headers: makeHeaders(email),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) return null;
  const work = await resp.json();
  return fromOpenAlex(work);
}
