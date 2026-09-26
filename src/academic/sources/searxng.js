/**
 * SearXNG Academic Metasearch source plugin (via 9router).
 * Fast, free, private metasearch across academic databases, preprint repositories,
 * publisher portals (ScienceDirect, Springer, MDPI, IEEE, Nature), and grey literature.
 */

import { fromSearXNG } from "../formatter.js";
import { filterByRelevance } from "./_relevance.js";
import { NINE_ROUTER_API_KEY } from "../../config.js";

export const id = "searxng";
export const name = "SearXNG (9router Metasearch)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["all", "science", "preprints", "grey_literature", "web"];

const SEARXNG_DIRECT_URL = (
  process.env.SEARXNG_URL ||
  "http://45.251.114.101:8888"
).replace(/\/$/, "");

const SEARCH_BASE_URL = (
  process.env.NINE_ROUTER_BASE_URL ||
  process.env["9ROUTER_BASE_URL"] ||
  "https://9router.phongdang.io.vn/v1"
).replace(/\/$/, "");

const TIMEOUT_MS = 20_000;

/**
 * @param {string} query
 * @param {Object} opts
 * @param {Object} config
 * @returns {Promise<{papers: Array, total: number}>}
 */
export async function search(query, opts = {}, config = {}) {
  const {
    limit = 10,
    year_min,
    year_max,
    signal,
  } = opts;

  let refinedQuery = query;
  if (year_min && year_max) {
    refinedQuery = `${query} ${year_min}..${year_max}`;
  } else if (year_min) {
    refinedQuery = `${query} ${year_min}`;
  }

  // 1. Primary: Direct query to SearXNG container on VPS (fast, zero auth overhead)
  const searxUrl = config.searxngUrl || SEARXNG_DIRECT_URL;
  try {
    const directEndpoint = `${searxUrl}/search?q=${encodeURIComponent(refinedQuery)}&format=json&categories=science`;
    const resp = await fetch(directEndpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "UMP-Paper-Search/1.0 (academic-metasearch)",
      },
      signal: signal || AbortSignal.timeout(TIMEOUT_MS),
    });

    if (resp.ok) {
      const data = await resp.json();
      const results = data.results || [];
      // A metasearch hit is a web page, not a vetted record: without a
      // relevance gate an unrelated conference report ranks alongside the
      // paper that was actually asked for.
      const papers = onTopic(
        results.map((r) =>
          fromSearXNG({
            title: r.title,
            url: r.url,
            snippet: r.content,
            published_at: r.publishedDate,
            display_url: r.engine,
          })
        ),
        query
      ).slice(0, limit);

      return {
        papers,
        total: data.number_of_results ?? results.length,
      };
    }
  } catch (err) {
    console.warn(`[searxng] Direct SearXNG connection error (${err.message}). Trying 9router fallback...`);
  }

  // 2. Fallback: 9router SearXNG gateway
  const apiKey = config.nineRouterApiKey || NINE_ROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY || "";
  const endpoint = `${SEARCH_BASE_URL}/search`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: "searxng",
      query: refinedQuery,
      search_type: "science",
      max_results: Math.min(limit * 2, 30),
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`SearXNG 9router HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const results = data.results || [];
  const papers = onTopic(results.map(fromSearXNG), query).slice(0, limit);

  return {
    papers,
    total: data.metrics?.total_results_available ?? results.length,
  };
}

/**
 * Drop metasearch hits that do not actually cover the query.
 *
 * @param {Array} papers
 * @param {string} query
 * @returns {Array}
 */
function onTopic(papers, query) {
  return filterByRelevance(papers, query, {
    getTitle: (p) => p.title || "",
    getText: (p) => `${p.title || ""} ${p.abstract || ""}`,
    minCoverage: 0.5,
  });
}
