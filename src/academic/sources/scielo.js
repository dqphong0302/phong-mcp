/**
 * SciELO (Scientific Electronic Library Online) source plugin.
 * Free, Open Access, no API key required.
 *
 * Major open access cooperative publishing model for Latin America,
 * Spain, Portugal, and South Africa (>1,200 peer-reviewed journals).
 * Crossref prefix 10.1590.
 */

import { fromCrossref } from "../formatter.js";

export const id = "scielo";
export const name = "SciELO (Scientific Electronic Library Online — Latin America & Global South)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "public_health", "agriculture", "biology", "social_science", "global_south", "open_access"];
export const available = true;

const CROSSREF_API = "https://api.crossref.org/works";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;

  const filters = ["prefix:10.1590"];
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
      p.source = "scielo";
      p.venue = p.venue || "SciELO Journals";
      p.is_oa = true;
      if (!p.pdf_url && p.doi) {
        p.pdf_url = `https://www.scielo.br/j/${p.doi}`;
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
    p.source = "scielo";
    p.venue = p.venue || "SciELO Journals";
    p.is_oa = true;
    return p;
  } catch {
    return null;
  }
}
