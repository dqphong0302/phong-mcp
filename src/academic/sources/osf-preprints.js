/**
 * OSF Preprints (Center for Open Science) — the umbrella host for SocArXiv,
 * PsyArXiv, EdArXiv, EngrXiv, MetaArXiv, AfricArXiv and ~30 more servers.
 * Fills the social-science / humanities preprint gap that arXiv does not cover.
 * Free JSON:API, no key.
 * Docs: https://developer.osf.io/
 */

import { withTimeout } from "./_ojs.js";

export const id = "osf_preprints";
export const name = "OSF Preprints (SocArXiv, PsyArXiv, EdArXiv, EngrXiv, ...)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["social_science", "psychology", "education", "humanities", "preprints", "open_access"];

const API = "https://api.osf.io/v2/preprints/";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    "filter[title]": query,
    "page[size]": String(Math.min(limit, 100)),
    sort: "-date_published",
    embed: "contributors",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/vnd.api+json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const item of data?.data || []) {
      const a = item.attributes || {};
      const date = a.date_published || a.date_created;
      const year = date ? parseInt(String(date).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }
      const provider = item.relationships?.provider?.data?.id || "osf";
      const authors = (item.embeds?.contributors?.data || [])
        .map((c) => c.embeds?.users?.data?.attributes?.full_name || c.attributes?.full_name)
        .filter(Boolean);
      papers.push({
        id: a.doi ? `doi:${a.doi}` : `osf_preprints:${item.id}`,
        title: a.title || "",
        authors,
        year: Number.isFinite(year) ? year : null,
        doi: a.doi || null,
        arxiv_id: null,
        abstract: a.description || null,
        citation_count: null,
        pdf_url: `https://osf.io/${item.id}/download`,
        url: `https://osf.io/preprints/${provider}/${item.id}`,
        source: "osf_preprints",
        venue: `OSF Preprints (${provider})`,
        volume: null,
        issue: null,
        pages: null,
        publisher: "Center for Open Science",
        type: "preprint",
        issn: null,
        is_oa: true,
      });
      if (papers.length >= limit) break;
    }

    return { papers, total: data?.links?.meta?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[osf_preprints] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchOsfPreprints };
