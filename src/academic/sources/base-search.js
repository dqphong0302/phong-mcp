/**
 * BASE — Bielefeld Academic Search Engine. ~400M OA documents harvested from
 * ~11,000 repositories worldwide, including a long tail of regional and
 * non-English journals that OpenAlex and Crossref miss.
 *
 * Access is granted per source IP, not per key: register at
 * https://www.base-search.net/about/en/faq_use.php then set
 * BASE_SEARCH_ENABLED=1 so this source stops being skipped.
 * Docs: https://api.base-search.net/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "base_search";
export const name = "BASE (Bielefeld Academic Search Engine — 400M OA documents)";
export const requiresKey = true;
export const keyEnvVar = "BASE_SEARCH_ENABLED";
export const domains = ["general", "open_access", "repositories", "grey_literature"];

const API = "https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi";

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  let q = query;
  if (year_min && year_max) q += ` AND dcyear:[${year_min} TO ${year_max}]`;
  else if (year_min) q += ` AND dcyear:[${year_min} TO *]`;
  else if (year_max) q += ` AND dcyear:[* TO ${year_max}]`;

  const params = new URLSearchParams({
    func: "PerformSearch",
    query: q,
    format: "json",
    hits: String(Math.min(limit, 100)),
    coll: "all",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const r = data?.response || {};
    const docs = r.docs || [];

    const papers = docs.slice(0, limit).map((d) => {
      const year = d.dcyear ? parseInt(String(first(d.dcyear)), 10) : null;
      const link = first(d.dclink) || first(d.dcidentifier);
      const doi = first(d.dcdoi) || null;
      // BASE OA flag: 1 = fully open access
      const oa = String(first(d.dcoa) ?? "") === "1";
      return {
        id: doi ? `doi:${doi}` : `base_search:${d.dcdocid || link}`,
        title: stripHtml(first(d.dctitle) || ""),
        authors: Array.isArray(d.dccreator) ? d.dccreator : d.dccreator ? [d.dccreator] : [],
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: null,
        abstract: first(d.dcdescription) ? stripHtml(first(d.dcdescription)) : null,
        citation_count: null,
        pdf_url: null,
        url: link,
        source: "base_search",
        venue: first(d.dcsource) || first(d.dcpublisher) || "BASE",
        volume: null,
        issue: null,
        pages: null,
        publisher: first(d.dcpublisher) || null,
        type: /thesis|dissertation/i.test(String(first(d.dctype) || "")) ? "dissertation" : "article",
        issn: null,
        is_oa: oa,
      };
    }).filter((p) => p.title);

    return { papers, total: r.numFound ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[base_search] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchBase };
