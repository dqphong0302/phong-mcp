/**
 * Springer Nature Metadata API v2 client.
 * Free API key required: https://dev.springernature.com/
 * Docs: https://dev.springernature.com/docs
 *
 * Covers: Nature, SpringerLink, BMC, Scientific Reports, and 3000+ other journals.
 * Register at: https://dev.springernature.com/ → Sign up for free
 * Note: Free tier gives metadata (title, authors, DOI, abstract snippet, dates).
 *       Full abstract available for open-access articles.
 */

import { fromSpringer } from "./formatter.js";

const BASE = "https://api.springernature.com/meta/v2/json";

/**
 * Search papers via Springer Nature Metadata API.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {string}  [opts.apiKey]       - Required: SPRINGER_API_KEY env var
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchSpringer(query, opts = {}) {
  const {
    limit = 10,
    apiKey,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
  } = opts;

  if (!apiKey) throw new Error("Springer Nature API key required. Set SPRINGER_API_KEY env var (free: https://dev.springernature.com/)");

  // Springer query syntax supports field-specific searches
  let q = query;
  if (year_min) q += ` datefrom:${year_min}-01-01`;
  if (year_max) q += ` dateto:${year_max}-12-31`;
  if (open_access_only) q += " type:Journal openaccess:true";

  const url = new URL(BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("p", String(Math.min(limit, 50))); // page size
  url.searchParams.set("s", "1"); // start record

  // Springer API doesn't support sort parameter in free tier — relevance is default
  // For recency, we can add a date sort hint
  if (sort === "recency") url.searchParams.set("s", "1"); // no native sort, recency needs date-based filtering

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`Springer Nature HTTP ${resp.status}: ${msg.slice(0, 200)}`);
  }

  const data = await resp.json();
  const records = data.records || [];
  const total = parseInt(data.result?.[0]?.total || String(records.length), 10);

  return {
    papers: records.map(fromSpringer),
    total,
  };
}
