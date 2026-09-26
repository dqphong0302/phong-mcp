/**
 * Zenodo source plugin.
 * Free, no API key required.
 * Docs: https://developers.zenodo.org/
 *
 * Coverage: 2M+ publications, datasets, software — all OA.
 * Strong for EU research, data papers, grey literature.
 */

import { fromZenodo } from "../formatter.js";

export const id = "zenodo";
export const name = "Zenodo";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "data", "eu_research", "open_access"];

const BASE = "https://zenodo.org/api";

/**
 * Zenodo rejects both node's default User-Agent and browser-like ones with a
 * 403; a descriptive tool identifier is what it wants, and is what an API
 * client should be sending anyway.
 */
const UA = `academic-search-mcp/2.0 (+mailto:${process.env.UNPAYWALL_EMAIL || "unset"})`;

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  const params = new URLSearchParams({
    q: query,
    type: "publication",
    size: String(Math.min(limit, 50)),
    page: "1",
    sort: sort === "recency" ? "mostrecent" : "bestmatch",
  });

  if (year_min || year_max) {
    const from = year_min ? `${year_min}-01-01` : "1900-01-01";
    const to = year_max ? `${year_max}-12-31` : "2099-12-31";
    params.set("q", `${query} AND publication_date:[${from} TO ${to}]`);
  }

  const resp = await fetch(`${BASE}/records?${params}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`Zenodo HTTP ${resp.status}`);
  const data = await resp.json();

  return {
    papers: (data.hits?.hits || []).map(fromZenodo),
    total: data.hits?.total || 0,
  };
}

export async function getById(doi, _config = {}) {
  if (!doi) return null;
  try {
    const resp = await fetch(`${BASE}/records?q=doi:"${encodeURIComponent(doi)}"&type=publication&size=1`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const hit = data.hits?.hits?.[0];
    return hit ? fromZenodo(hit) : null;
  } catch {
    return null;
  }
}
