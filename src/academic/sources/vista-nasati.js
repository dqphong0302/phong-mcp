/**
 * VISTA / NASATI (Cục Thông tin KH&CN Quốc gia — Bộ Khoa học và Công nghệ).
 * Vietnam National Science and Technology publication database.
 * Free, open, no API key required.
 * Website: https://sti.vista.gov.vn/
 */

import { withTimeout, stripHtml } from "./_ojs.js";
import { filterByRelevance } from "./_relevance.js";

export const id = "vista_nasati";
export const name = "VISTA / NASATI (Bộ KH&CN Việt Nam)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["science", "technology", "medicine", "agriculture", "vietnam_science", "vietnam_medical"];

const BASE_URL = "https://sti.vista.gov.vn";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const searchUrl = `${BASE_URL}/publication.html?q=${encodeURIComponent(query)}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: withTimeout(signal),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const html = await resp.text();

    const papers = [];
    const itemRegex = /<a[^>]+href=["']((?:https:\/\/sti\.vista\.gov\.vn)?\/publication\/view\/([^"']+?)-(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = itemRegex.exec(html)) !== null && papers.length < limit) {
      const href = match[1];
      const slug = match[2];
      const pubId = match[3];
      const title = stripHtml(match[4]);

      if (!title || title.length < 5 || seen.has(pubId)) continue;
      seen.add(pubId);

      // Year only when the slug actually carries one — never "current year".
      const yrMatch = slug.match(/-(19\d{2}|20\d{2})(?:-|$)/);
      const year = yrMatch ? parseInt(yrMatch[1], 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;

      papers.push({
        id: `vista_nasati:${pubId}`,
        title,
        authors: [],
        year,
        doi: null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        // The landing page is HTML, not a PDF — leave pdf_url null and let the
        // OJS/PDF resolver decide, otherwise open_access_only lets through a
        // download that can never succeed.
        pdf_url: null,
        url,
        source: "vista_nasati",
        venue: "Cơ sở dữ liệu Công bố KH&CN Quốc gia (VISTA / NASATI)",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Bộ Khoa học và Công nghệ Việt Nam",
        type: "article",
        issn: null,
        is_oa: true,
      });
    }

    // The portal ignores the `q` parameter on this endpoint and serves its
    // newest publications regardless of the query, so relevance has to be
    // enforced here. Without this a search for "đái tháo đường" returns papers
    // on concrete quality and military drill.
    const relevant = filterByRelevance(papers, query, {
      getTitle: (p) => p.title || "",
      getText: (p) => p.title || "",
    });

    // The portal ignores the query parameter on this endpoint and serves its
    // newest publications whatever is asked. Its real search runs in JavaScript
    // against an endpoint that answers "Bạn không có quyền truy cập link này"
    // to anything without a browser session, so keyword search is not available
    // here. Say so, rather than reporting an empty literature: a search for
    // "đái tháo đường" otherwise looks like Vietnam has no diabetes research.
    if (papers.length > 0 && relevant.length === 0) {
      return {
        papers: [],
        total: 0,
        unavailable: true,
        reason: "portal ignores the query parameter; its keyword search requires a browser session",
      };
    }

    const totalMatch = html.match(/(?:tìm th(?:ấy|ay)|k(?:ế|e)t qu(?:ả|a))[^\d]{0,20}(\d[\d.,]*)/i);
    const upstreamTotal = totalMatch ? parseInt(totalMatch[1].replace(/[.,]/g, ""), 10) : null;
    // Report what we actually vouch for, not the portal's unfiltered count.
    const total = relevant.length < papers.length || !Number.isFinite(upstreamTotal)
      ? relevant.length
      : upstreamTotal;

    return { papers: relevant, total };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[vista_nasati] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

/** Fetch the real landing page; returns null instead of a placeholder record. */
export async function getById(paperId, _config = {}, opts = {}) {
  const cleanId = String(paperId).replace(/^vista(?:_nasati)?:/, "");
  const url = `${BASE_URL}/publication/view/${cleanId}.html`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (academic-search-mcp/2.0)", Accept: "text/html" },
      signal: withTimeout(opts.signal, 12000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const t = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = t ? stripHtml(t[1]) : null;
    if (!title) return null;
    return {
      id: `vista_nasati:${cleanId}`,
      title,
      authors: [],
      year: null,
      doi: null,
      abstract: null,
      pdf_url: null,
      url,
      source: "vista_nasati",
      venue: "Cơ sở dữ liệu Công bố KH&CN Quốc gia (VISTA / NASATI)",
      publisher: "Bộ Khoa học và Công nghệ Việt Nam",
      type: "article",
      is_oa: true,
    };
  } catch {
    return null;
  }
}

export { search as searchVistaNasati };
