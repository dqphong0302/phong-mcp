/**
 * MedPharmRes (Medical and Pharmaceutical Research Journal - UMP) Source Plugin.
 * Official English-language biomedical journal of University of Medicine and Pharmacy at Ho Chi Minh City.
 * Open Access, free, no API key required.
 * Website: https://medpharmres.com/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "medpharmres";
export const name = "MedPharmRes (ĐH Y Dược TP.HCM)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "pharmacy", "biomedical", "vietnam_medical", "clinical"];

const BASE_URL = "https://medpharmres.com";

/**
 * Search MedPharmRes journal by keyword.
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max } = opts;
  const searchUrl = `${BASE_URL}/archive/list_search?s_text_0=${encodeURIComponent(query)}&s_opt_0=all`;

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: withTimeout(opts.signal),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const html = await resp.text();

    const papers = [];
    // Extract articles from HTML: links to /archive/view_article?doi=...
    const articleRegex = /<a[^>]+href=["'](\/archive\/view_article\?doi=([^"']+))["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seenDois = new Set();

    while ((match = articleRegex.exec(html)) !== null && papers.length < limit) {
      const relUrl = match[1];
      const doi = decodeURIComponent(match[2].trim());
      let title = stripHtml(match[3]);

      if (!title || title.toLowerCase() === "html" || title.toLowerCase() === "pubreader" || seenDois.has(doi)) {
        continue;
      }
      seenDois.add(doi);

      // Extract year from DOI if available (e.g. 10.32895/MPR.25.00094 -> 2025, or 10.32895/UMP.MPR.8.2.15 -> 2024)
      let year = null;
      // The citation line states it outright: "MedPharmRes 2020;4(1):18-22".
      // Deriving it from the DOI instead mislabels every record whose DOI does
      // not carry a volume that happens to look like a year.
      const bibr = html.match(
        new RegExp(`${doi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]{0,400}?MedPharmRes\\s+(19|20)(\\d{2})`, "i")
      );
      if (bibr) {
        year = parseInt(`${bibr[1]}${bibr[2]}`, 10);
      }
      const yrMatch = year ? null : doi.match(/MPR\.(\d{2})\./i);
      if (yrMatch) {
        year = 2000 + parseInt(yrMatch[1], 10);
      } else if (!year) {
        const yrMatch2 = html.match(new RegExp(`${doi}[\\s\\S]{0,200}?(20\\d{2})`, "i"));
        if (yrMatch2) year = parseInt(yrMatch2[1], 10);
      }

      if (year_min && year && year < year_min) continue;
      if (year_max && year && year > year_max) continue;

      // Authors, when the listing renders them near the link. Never a placeholder.
      const after = html.slice(match.index, match.index + 600);
      const authorMatch = after.match(/<(?:p|div|span)[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
      const authors = authorMatch
        ? stripHtml(authorMatch[1]).split(/[,;]/).map((a) => a.trim()).filter((a) => a.length > 1 && a.length < 120)
        : [];

      papers.push({
        id: `doi:${doi}`,
        title,
        authors,
        year,
        doi,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: `${BASE_URL}/archive/view_article_pdf?doi=${encodeURIComponent(doi)}`,
        url: `${BASE_URL}${relUrl}`,
        source: "medpharmres",
        venue: "MedPharmRes - Medical and Pharmaceutical Research (UMP)",
        volume: null,
        issue: null,
        pages: null,
        publisher: "University of Medicine and Pharmacy at Ho Chi Minh City",
        type: "article",
        issn: "2615-9139",
        is_oa: true
      });
    }

    return {
      papers: papers.slice(0, limit),
      total: papers.length
    };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[medpharmres] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(doi, _config = {}, _opts = {}) {
  if (!doi.startsWith("10.32895/")) return null;
  return {
    id: `doi:${doi}`,
    title: `MedPharmRes ${doi}`,
    authors: [],
    year: null,
    doi,
    url: `${BASE_URL}/archive/view_article?doi=${encodeURIComponent(doi)}`,
    pdf_url: `${BASE_URL}/archive/view_article_pdf?doi=${encodeURIComponent(doi)}`,
    source: "medpharmres",
    venue: "MedPharmRes",
    is_oa: true
  };
}
