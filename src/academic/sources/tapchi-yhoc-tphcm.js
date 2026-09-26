/**
 * Tạp chí Y học Thành phố Hồ Chí Minh (Ho Chi Minh City Journal of Medicine).
 * Peer-reviewed medical journal of Đại học Y Dược TP.HCM. Open Access, no key.
 * Website: https://tapchiyhoctphcm.vn/
 *
 * NOTE: the site exposes no query endpoint, so this plugin browses the issue
 * listing and filters locally. Matching is diacritic-insensitive and STRICT —
 * a non-matching article is never returned (the previous version leaked the
 * first two articles of the listing into every result set).
 */

import { withTimeout, stripHtml } from "./_ojs.js";
import { tokenizeQuery, relevanceScore } from "./_relevance.js";

export const id = "tapchi_yhoc_tphcm";
export const name = "Tạp chí Y học TP.HCM (ĐH Y Dược TP.HCM)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "clinical", "vietnam_medical", "pharmacy", "public_health"];

/** Minimum share of the query's content terms a record must carry (0.5 allows 1/2 for 2-word queries like 'tim mạch'). */
const MIN_RELEVANCE = 0.5;

const BASE_URL = "https://tapchiyhoctphcm.vn";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const queryTerms = tokenizeQuery(query);

  try {
    const resp = await fetch(`${BASE_URL}/issues`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: withTimeout(signal),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const html = await resp.text();

    const blocks = html.split(/<div[^>]*class=["'][^"']*col-11[^"']*["'][^>]*>/i).slice(1);
    const papers = [];
    const seen = new Set();

    for (const block of blocks) {
      if (papers.length >= limit) break;

      const artMatch = block.match(/href=["'](\/articles\/(\d+))["']/i);
      if (!artMatch) continue;
      const relUrl = artMatch[1];
      const artId = artMatch[2];
      if (seen.has(artId)) continue;
      seen.add(artId);

      const titleMatch = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
      const title = titleMatch ? stripHtml(titleMatch[1]) : null;
      if (!title || title.length < 4) continue;

      const authorMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const authors = authorMatch
        ? stripHtml(authorMatch[1]).split(/[,;]/).map((a) => a.trim()).filter((a) => a.length > 1 && a.length < 120)
        : [];

      const pdfMatch = block.match(/href=["'](\/upload\/[^"']+\.pdf)["']/i);
      const pdfUrl = pdfMatch ? `${BASE_URL}${pdfMatch[1]}` : null;

      const yrMatch = block.match(/\/upload\/(20\d{2})\//i) || block.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yrMatch ? parseInt(yrMatch[1], 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      // Relevance gate. This endpoint only renders the latest issue, so every
      // record has to earn its place against the query here. A single-substring
      // gate is not enough: "tri" would match "trung" and let the whole issue
      // through.
      if (queryTerms.length > 0) {
        const score = Math.max(
          relevanceScore(title, queryTerms, query),
          relevanceScore(`${title} ${authors.join(" ")}`, queryTerms, query)
        );
        if (score < MIN_RELEVANCE) continue;
      }

      papers.push({
        id: `tapchi_yhoc_tphcm:${artId}`,
        title,
        authors,
        year,
        doi: null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: pdfUrl,
        url: `${BASE_URL}${relUrl}`,
        source: "tapchi_yhoc_tphcm",
        venue: "Tạp chí Y học Thành phố Hồ Chí Minh (Med J Ho Chi Minh City)",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Đại học Y Dược Thành phố Hồ Chí Minh",
        type: "article",
        issn: "1859-1779",
        is_oa: true,
      });
    }

    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[tapchi_yhoc_tphcm] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(paperId, _config = {}, opts = {}) {
  const cleanId = String(paperId).replace(/^(?:tcyh|tapchi_yhoc_tphcm):/, "");
  if (!/^\d+$/.test(cleanId)) return null;
  const url = `${BASE_URL}/articles/${cleanId}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (academic-search-mcp/2.0)", Accept: "text/html" },
      signal: withTimeout(opts.signal, 12000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const t = html.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i);
    const title = t ? stripHtml(t[1]) : null;
    if (!title) return null;
    const pdfMatch = html.match(/href=["'](\/upload\/[^"']+\.pdf)["']/i);
    return {
      id: `tapchi_yhoc_tphcm:${cleanId}`,
      title,
      authors: [],
      year: null,
      doi: null,
      abstract: null,
      pdf_url: pdfMatch ? `${BASE_URL}${pdfMatch[1]}` : null,
      url,
      source: "tapchi_yhoc_tphcm",
      venue: "Tạp chí Y học Thành phố Hồ Chí Minh",
      publisher: "Đại học Y Dược Thành phố Hồ Chí Minh",
      type: "article",
      issn: "1859-1779",
      is_oa: true,
    };
  } catch {
    return null;
  }
}

export { search as searchTapchiYhocTphcm };
