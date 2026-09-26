/**
 * SSRN (Social Science Research Network) source plugin.
 * Free, no API key required.
 *
 * Leading preprint repository for economics, finance, law, governance,
 * accounting, management, social sciences and humanities.
 * Officially indexed via Crossref prefix 10.2139 with full metadata and direct links.
 */

import { fromCrossref } from "../formatter.js";

export const id = "ssrn";
export const name = "SSRN (Social Science Research Network Preprints)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["economics", "finance", "law", "social_science", "management", "governance", "open_access"];
export const available = true;

const CROSSREF_API = "https://api.crossref.org/works";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;

  const filters = ["prefix:10.2139"];
  if (year_min) filters.push(`from-pub-date:${year_min}-01-01`);
  if (year_max) filters.push(`until-pub-date:${year_max}-12-31`);

  const params = new URLSearchParams({
    query,
    filter: filters.join(","),
    rows: String(Math.min(limit, 50)),
    sort: sort === "recency" ? "published" : "score",
    order: "desc",
  });

  try {
    const resp = await fetch(`${CROSSREF_API}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (mailto:dqphong0302@gmail.com)",
      },
      signal: signal || AbortSignal.timeout(20000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const items = data.message?.items || [];
    const total = data.message?.["total-results"] || items.length;

    const papers = items.map((item) => {
      const p = fromCrossref(item);
      p.source = "ssrn";
      p.venue = "SSRN Electronic Journal";
      p.type = "preprint";
      p.is_oa = true;
      if (!p.url && p.doi) {
        p.url = `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${p.doi.replace(/^10\.2139\/ssrn\./i, "")}`;
      }
      return p;
    });

    return {
      papers: papers.slice(0, limit),
      total,
    };
  } catch {
    return { papers: [], total: 0 };
  }
}

export async function getById(doi, _config = {}, opts = {}) {
  if (!doi) return null;
  try {
    const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const resp = await fetch(`${CROSSREF_API}/${encodeURIComponent(cleanDoi)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (mailto:dqphong0302@gmail.com)",
      },
      signal: opts.signal || AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const item = data.message;
    if (!item) return null;
    const p = fromCrossref(item);
    p.source = "ssrn";
    p.venue = "SSRN Electronic Journal";
    p.type = "preprint";
    p.is_oa = true;
    return p;
  } catch {
    return null;
  }
}
