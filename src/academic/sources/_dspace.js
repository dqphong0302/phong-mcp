/**
 * Shared client for DSpace 7 repositories.
 *
 * DSpace powers a large share of institutional and intergovernmental
 * repositories — WHO IRIS, FAO Knowledge Repository, DOAB, most university
 * archives — and they all expose the same discovery endpoint:
 *   {base}/server/api/discover/search/objects?query=...&dsoType=item
 *
 * Metadata arrives as { "dc.title": [{ value }], ... } so one parser serves
 * every one of them.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

const mv = (meta, key) => (meta?.[key] || []).map((x) => x?.value).filter(Boolean);
const m1 = (meta, ...keys) => {
  for (const k of keys) {
    const v = mv(meta, k)[0];
    if (v) return v;
  }
  return null;
};

const cleanDoi = (d) => {
  const s = String(d || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  return /^10\.\d{4,}\//.test(s) ? s : null;
};

/**
 * @param {string} query
 * @param {Object} opts   - { limit, year_min, year_max, signal }
 * @param {Object} site   - { baseUrl, sourceId, publisher, defaultVenue, type }
 */
export async function searchDspace(query, opts = {}, site) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    query,
    size: String(Math.min(limit * 2, 100)),
    dsoType: "item",
  });

  try {
    const resp = await fetch(`${site.baseUrl}/server/api/discover/search/objects?${params}`, {
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
      const yr = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : NaN;
      const year = Number.isFinite(yr) ? yr : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const doi = cleanDoi(m1(meta, "dc.identifier.doi", "dcterms.identifier"));
      const handle = item.handle || item.uuid;
      const authors = mv(meta, "dc.contributor.author").length
        ? mv(meta, "dc.contributor.author")
        : mv(meta, "dc.creator");

      papers.push({
        id: doi ? `doi:${doi}` : `${site.sourceId}:${handle}`,
        title,
        authors,
        year,
        doi,
        arxiv_id: null,
        abstract: m1(meta, "dc.description.abstract")
          ? stripHtml(m1(meta, "dc.description.abstract"))
          : null,
        citation_count: null,
        pdf_url: null,
        url: handle ? `${site.baseUrl}/handle/${handle}` : null,
        source: site.sourceId,
        venue: m1(meta, "dc.relation.ispartofseries") || site.defaultVenue,
        volume: null,
        issue: null,
        pages: null,
        publisher: m1(meta, "dc.publisher") || site.publisher,
        type: site.type || "policy_report",
        issn: m1(meta, "dc.identifier.issn"),
        is_oa: true,
      });
    }

    return { papers, total: sr?.page?.totalElements ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn(`[${site.sourceId}] search error:`, err.message);
    }
    return { papers: [], total: 0 };
  }
}
