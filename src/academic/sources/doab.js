/**
 * DOAB — Directory of Open Access Books. ~90k peer-reviewed OA academic books
 * and chapters; the main gap for humanities and social sciences, where the
 * monograph rather than the article is the unit of publication. Free, no key.
 * Docs: https://directory.doabooks.org/
 */

import { withTimeout } from "./_ojs.js";

export const id = "doab";
export const name = "DOAB (Directory of Open Access Books)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["humanities", "social_science", "books", "open_access"];

const API = "https://directory.doabooks.org/rest/search";

/** DSpace REST metadata rows → { key: [values] } */
function metaMap(rows) {
  const m = {};
  for (const r of rows || []) {
    if (!r?.key) continue;
    (m[r.key] ||= []).push(r.value);
  }
  return m;
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    query,
    expand: "metadata",
    limit: String(Math.min(limit * 2, 100)),
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const rows = await resp.json();

    const papers = [];
    for (const item of Array.isArray(rows) ? rows : []) {
      const m = metaMap(item.metadata);
      const dateRaw = (m["dc.date.issued"] || [])[0];
      const year = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }
      const doi = (m["oapen.identifier.doi"] || m["dc.identifier.doi"] || [])[0] || null;
      const handle = item.handle || item.id;
      papers.push({
        id: doi ? `doi:${doi}` : `doab:${handle}`,
        title: item.name || (m["dc.title"] || [])[0] || "",
        authors: m["dc.contributor.author"] || m["dc.creator"] || [],
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: null,
        abstract: (m["dc.description.abstract"] || [])[0] || null,
        citation_count: null,
        pdf_url: (m["oapen.identifier.pdf"] || [])[0] || null,
        url: doi ? `https://doi.org/${doi}` : `https://directory.doabooks.org/handle/${handle}`,
        source: "doab",
        venue: (m["publisher.name"] || m["dc.publisher"] || [])[0] || "Open Access Book (DOAB)",
        volume: null,
        issue: null,
        pages: null,
        publisher: (m["publisher.name"] || m["dc.publisher"] || [])[0] || null,
        type: "book",
        issn: (m["dc.identifier.issn"] || [])[0] || null,
        is_oa: true,
      });
      if (papers.length >= limit) break;
    }

    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[doab] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchDoab };
