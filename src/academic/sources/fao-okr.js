/**
 * FAO Knowledge Repository (openknowledge.fao.org) — DSpace 7.
 * Agriculture, fisheries, forestry, food security, nutrition policy. This is
 * the practical substitute for AGRIS, which exposes no public REST search API.
 * Free, no key.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "fao_okr";
export const name = "FAO Knowledge Repository (nông – lâm – ngư & an ninh lương thực)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["agriculture", "fisheries", "forestry", "food_security", "nutrition", "policy", "open_access"];

const BASE = "https://openknowledge.fao.org";
const API = `${BASE}/server/api/discover/search/objects`;

/** DSpace 7 metadata: { "dc.title": [{ value }], ... } */
const mv = (meta, key) => (meta?.[key] || []).map((x) => x?.value).filter(Boolean);
const m1 = (meta, ...keys) => { for (const k of keys) { const v = mv(meta, k)[0]; if (v) return v; } return null; };

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    query,
    size: String(Math.min(limit * 2, 100)),
    dsoType: "item",
    embed: "bundles/bitstreams",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const sr = data?._embedded?.searchResult;
    const objects = sr?._embedded?.objects || [];

    const papers = [];
    for (const o of objects) {
      if (papers.length >= limit) break;
      const item = o?._embedded?.indexableObject;
      if (!item) continue;
      const meta = item.metadata || {};

      const title = stripHtml(m1(meta, "dc.title") || item.name || "");
      if (!title) continue;

      const dateRaw = m1(meta, "dc.date.issued", "dcterms.issued");
      const year = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const doi = (m1(meta, "dc.identifier.doi", "dcterms.identifier") || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null;
      const handle = item.handle || item.uuid;

      papers.push({
        id: doi ? `doi:${doi}` : `fao_okr:${handle}`,
        title,
        authors: mv(meta, "dc.contributor.author").length ? mv(meta, "dc.contributor.author") : mv(meta, "dc.creator"),
        year: Number.isFinite(year) ? year : null,
        doi: /^10\./.test(doi || "") ? doi : null,
        arxiv_id: null,
        abstract: m1(meta, "dc.description.abstract") ? stripHtml(m1(meta, "dc.description.abstract")) : null,
        citation_count: null,
        pdf_url: null,
        url: handle ? `${BASE}/handle/${handle}` : null,
        source: "fao_okr",
        venue: m1(meta, "dc.relation.ispartofseries") || "FAO Knowledge Repository",
        volume: null,
        issue: null,
        pages: null,
        publisher: m1(meta, "dc.publisher") || "Food and Agriculture Organization of the United Nations (FAO)",
        type: "policy_report",
        issn: m1(meta, "dc.identifier.issn"),
        is_oa: true,
      });
    }

    return { papers, total: sr?.page?.totalElements ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[fao_okr] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchFaoOkr };
