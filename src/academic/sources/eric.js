/**
 * ERIC — Education Resources Information Center (Institute of Education
 * Sciences, U.S. Dept. of Education). ~2M education records, free JSON API,
 * no key. Full text is OA for a large share of records.
 * Docs: https://api.ies.ed.gov/eric/
 */

import { withTimeout } from "./_ojs.js";

export const id = "eric";
export const name = "ERIC (Education Resources Information Center)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["education", "pedagogy", "social_science", "open_access"];

const API = "https://api.ies.ed.gov/eric/";
const FIELDS = "id,title,author,description,publicationdateyear,source,publicationtype,issn,url,e_fulltextauth,peerreviewed,subject";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  let q = `"${query.replace(/"/g, "")}"`;
  if (year_min && year_max) q += ` AND publicationdateyear:[${year_min} TO ${year_max}]`;
  else if (year_min) q += ` AND publicationdateyear:[${year_min} TO 3000]`;
  else if (year_max) q += ` AND publicationdateyear:[0 TO ${year_max}]`;

  const url = `${API}?search=${encodeURIComponent(q)}&format=json&rows=${Math.min(limit, 200)}&fields=${FIELDS}`;

  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: withTimeout(signal, 20000) });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    const papers = docs.slice(0, limit).map((d) => {
      const ericId = d.id;
      const hasFullText = d.e_fulltextauth === 1 || d.e_fulltextauth === "1" || d.e_fulltextauth === true;
      return {
        id: `eric:${ericId}`,
        title: Array.isArray(d.title) ? d.title[0] : d.title || "",
        authors: Array.isArray(d.author) ? d.author : d.author ? [d.author] : [],
        year: d.publicationdateyear ? parseInt(d.publicationdateyear, 10) : null,
        doi: null,
        arxiv_id: null,
        abstract: d.description || null,
        citation_count: null,
        pdf_url: hasFullText ? `https://files.eric.ed.gov/fulltext/${ericId}.pdf` : null,
        url: (Array.isArray(d.url) ? d.url[0] : d.url) || `https://eric.ed.gov/?id=${ericId}`,
        source: "eric",
        venue: Array.isArray(d.source) ? d.source[0] : d.source || "ERIC",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Institute of Education Sciences (IES), U.S. Department of Education",
        type: String(d.publicationtype || "").toLowerCase().includes("dissert") ? "dissertation" : "article",
        issn: Array.isArray(d.issn) ? d.issn[0] : d.issn || null,
        is_oa: hasFullText,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.response?.numFound ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[eric] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(paperId, _config = {}, opts = {}) {
  const ericId = String(paperId).replace(/^eric:/, "");
  const r = await search(`id:${ericId}`, { limit: 1, signal: opts.signal });
  return r.papers[0] || null;
}

export { search as searchEric };
