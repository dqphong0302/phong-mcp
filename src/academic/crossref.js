/**
 * Crossref API client.
 * Completely free, no API key required (mailto improves rate limit).
 * Docs: https://api.crossref.org/swagger-ui/index.html
 */

import { fromCrossref } from "./formatter.js";

const BASE = "https://api.crossref.org/works";

/**
 * Crossref record types that are publishing apparatus, not literature:
 * referee reports, editor decision letters, figures registered as their own
 * DOI, issue front matter. They are indexed alongside the article and would
 * otherwise crowd a result set — one paper under review can contribute five
 * "papers", none of them readable research.
 */
const NON_ARTICLE_TYPES = new Set([
  "peer-review",
  "component",
  "grant",
  "journal-issue",
  "journal-volume",
  "journal",
  "book-series",
  "book-set",
  "proceedings",
  "report-series",
  "standard-series",
]);

/** Titles Crossref gives referee reports and decision letters. */
const REVIEW_TITLE_RE = /^\s*(?:review|decision letter|referee report|author response|editorial decision)\s+(?:for|on|to)\b/i;

/**
 * Is this Crossref record an actual citable work?
 *
 * @param {Object} item raw Crossref message item
 * @returns {boolean}
 */
export function isCitableWork(item) {
  if (!item) return false;
  if (NON_ARTICLE_TYPES.has(String(item.type || "").toLowerCase())) return false;

  const title = (item.title && item.title[0]) || "";
  if (REVIEW_TITLE_RE.test(title)) return false;

  // Review/decision DOIs are minted as suffixes of the article DOI.
  const doi = String(item.DOI || "").toLowerCase();
  if (/\/(?:v\d+\/)?(?:review\d*|decision\d*|rr\d*)$/.test(doi)) return false;

  return true;
}

/**
 * Search papers via Crossref.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {string}  [opts.email]  - used for polite pool (better rate limit)
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchCrossref(query, opts = {}) {
  const { limit = 10, year_min, year_max, open_access_only = false, email } = opts;

  const params = new URLSearchParams();
  params.set("query", query);
  // Over-fetch: peer reviews and decision letters are dropped below, and a
  // single article under review can account for five of them. Without headroom
  // the caller silently receives far fewer papers than it asked for.
  params.set("rows", String(Math.min(limit * 3, 100)));
  if (email) params.set("mailto", email);

  const filters = [];
  if (year_min) filters.push(`from-pub-date:${year_min}-01-01`);
  if (year_max) filters.push(`until-pub-date:${year_max}-12-31`);
  if (filters.length > 0) params.set("filter", filters.join(","));

  const res = await fetch(`${BASE}?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Crossref error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const items = (data.message?.items || []).filter(isCitableWork);
  let papers = items.map(fromCrossref);

  // Post-filter: keep only papers that have a PDF link when open_access_only is requested
  if (open_access_only) papers = papers.filter((p) => p.pdf_url);

  return { papers: papers.slice(0, limit), total: data.message?.["total-results"] || 0 };
}
