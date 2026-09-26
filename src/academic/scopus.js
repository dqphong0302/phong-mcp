/**
 * Elsevier Scopus Search API client.
 * Free API key required: https://dev.elsevier.com/
 * Docs: https://dev.elsevier.com/documentation/ScopusSearchAPI.wadl
 *
 * NOTE: Scopus API may require institutional network or partner token for full abstract access.
 * A free developer key gives title, authors, citation count, DOI, venue, volume/issue/pages.
 * Register at: https://dev.elsevier.com/ → "Get an API Key"
 */

import { fromScopus } from "./formatter.js";

const BASE = "https://api.elsevier.com/content/search/scopus";

function makeHeaders(apiKey) {
  return {
    "X-ELS-APIKey": apiKey,
    Accept: "application/json",
  };
}

/**
 * Search papers via Elsevier Scopus API.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {string}  [opts.apiKey]       - Required: SCOPUS_API_KEY env var
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {boolean} [opts.open_access_only=false]
 * @param {"relevance"|"citations"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchScopus(query, opts = {}) {
  const {
    limit = 10,
    apiKey,
    year_min,
    year_max,
    open_access_only = false,
    sort = "relevance",
  } = opts;

  if (!apiKey) throw new Error("Scopus API key required. Set SCOPUS_API_KEY env var (free: https://dev.elsevier.com/)");

  // Scopus field-coded query language
  let q = `TITLE-ABS-KEY(${query})`;
  if (year_min && year_max) {
    q += ` AND PUBYEAR AFT ${year_min - 1} AND PUBYEAR BEF ${year_max + 1}`;
  } else if (year_min) {
    q += ` AND PUBYEAR AFT ${year_min - 1}`;
  } else if (year_max) {
    q += ` AND PUBYEAR BEF ${year_max + 1}`;
  }
  if (open_access_only) q += " AND OPENACCESS(1)";

  // Sort mapping — Scopus sort params
  const sortMap = {
    relevance: "relevancy",
    citations: "citedby-count",
    recency: "date",
  };

  // Request fields: include author[] for full author list beyond dc:creator (first author only)
  const fields = [
    "dc:title",
    "dc:creator",
    "author",
    "prism:publicationName",
    "prism:doi",
    "citedby-count",
    "prism:coverDate",
    "prism:volume",
    "prism:issueIdentifier",
    "prism:pageRange",
    "prism:url",
    "dc:identifier",
    "subtypeDescription",
    "openaccess",
    "prism:issn",
  ].join(",");

  const url = new URL(BASE);
  url.searchParams.set("query", q);
  url.searchParams.set("count", String(Math.min(limit, 25))); // Scopus free tier: 25 per request
  url.searchParams.set("start", "0");
  url.searchParams.set("sort", sortMap[sort] || "relevancy");
  url.searchParams.set("field", fields);

  const resp = await fetch(url, {
    headers: makeHeaders(apiKey),
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`Scopus HTTP ${resp.status}: ${msg.slice(0, 200)}`);
  }

  const data = await resp.json();
  const searchResults = data["search-results"] || {};
  const entries = searchResults.entry || [];
  const total = parseInt(searchResults["opensearch:totalResults"] || "0", 10);

  // Filter out the "No results found" placeholder entry Scopus sometimes returns
  const validEntries = entries.filter(
    (e) => e["dc:title"] && e["dc:title"] !== "No results found"
  );

  return {
    papers: validEntries.map(fromScopus),
    total,
  };
}
