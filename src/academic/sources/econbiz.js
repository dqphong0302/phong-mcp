/**
 * EconBiz (ZBW — Leibniz Information Centre for Economics).
 * Economics & business bibliography aggregating RePEc, EconStor, ECONIS and
 * more. Free JSON API, no key.
 * Docs: https://api.econbiz.de/doc
 */

import { withTimeout } from "./_ojs.js";

export const id = "econbiz";
export const name = "EconBiz / ZBW (Economics & Business, incl. RePEc + EconStor)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["economics", "business", "management", "finance", "social_science", "open_access"];

const API = "https://api.econbiz.de/v1/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({ q: query, size: String(Math.min(limit, 100)) });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const hits = data?.hits?.hits || [];

    const papers = [];
    for (const h of hits) {
      const year = h.date ? parseInt(String(h.date).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }
      const fullText = Array.isArray(h.fulltext) ? h.fulltext[0] : h.fulltext;
      papers.push({
        id: h.identifier ? `econbiz:${h.identifier}` : `econbiz:${h.id}`,
        title: Array.isArray(h.title) ? h.title[0] : h.title || "",
        authors: Array.isArray(h.creator) ? h.creator : h.creator ? [h.creator] : [],
        year: Number.isFinite(year) ? year : null,
        doi: h.doi || null,
        arxiv_id: null,
        abstract: Array.isArray(h.description) ? h.description[0] : h.description || null,
        citation_count: null,
        pdf_url: fullText && /\.pdf($|\?)/i.test(fullText) ? fullText : null,
        url: fullText || (h.id ? `https://www.econbiz.de/Record/${h.id}` : null),
        source: "econbiz",
        venue: Array.isArray(h.publisher) ? h.publisher[0] : h.publisher || "EconBiz (ZBW)",
        volume: null,
        issue: null,
        pages: null,
        publisher: "ZBW — Leibniz Information Centre for Economics",
        type: String(h.type || "").toLowerCase().includes("thesis") ? "dissertation" : "article",
        issn: null,
        is_oa: Boolean(fullText),
      });
      if (papers.length >= limit) break;
    }

    return { papers, total: data?.hits?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[econbiz] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchEconbiz };
