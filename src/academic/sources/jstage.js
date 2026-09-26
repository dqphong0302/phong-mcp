/**
 * J-STAGE (Japan Science and Technology Agency) — ~3,000 Japanese scholarly
 * journals, largely Open Access, strong in engineering, medicine and applied
 * science. Free public API (Atom XML), no key.
 * Docs: https://www.jstage.jst.go.jp/static/pages/JstageServices/TAB4/-char/en
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "jstage";
export const name = "J-STAGE (Japan Science & Technology Agency)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["science", "engineering", "medicine", "asia", "open_access"];

const API = "https://api.jstage.jst.go.jp/searchapi/do";

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? stripHtml(m[1]) : null;
}

function tagAll(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean);
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    service: "3",
    text: query,
    count: String(Math.min(limit, 100)),
  });
  if (year_min) params.set("pubyearfrom", String(year_min));
  if (year_max) params.set("pubyearto", String(year_max));

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/xml,text/xml", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const xml = await resp.text();

    const entries = xml.split(/<entry[\s>]/i).slice(1);
    const papers = [];

    for (const raw of entries) {
      if (papers.length >= limit) break;
      const e = raw;

      // Titles/journal names come in an <en> / <ja> pair; prefer English.
      const enTitle = (e.match(/<article_title>[\s\S]*?<en>([\s\S]*?)<\/en>/i) || [])[1];
      const jaTitle = (e.match(/<article_title>[\s\S]*?<ja>([\s\S]*?)<\/ja>/i) || [])[1];
      const title = stripHtml(enTitle || jaTitle || "");
      if (!title) continue;

      const enJournal = (e.match(/<material_title>[\s\S]*?<en>([\s\S]*?)<\/en>/i) || [])[1];
      const jaJournal = (e.match(/<material_title>[\s\S]*?<ja>([\s\S]*?)<\/ja>/i) || [])[1];

      const authorBlock = (e.match(/<author>([\s\S]*?)<\/author>/i) || [])[1] || "";
      const enNames = (authorBlock.match(/<en>([\s\S]*?)<\/en>/i) || [])[1] || "";
      const authors = tagAll(enNames, "name").length
        ? tagAll(enNames, "name")
        : tagAll(authorBlock, "name");

      const yearRaw = tag(e, "pubyear");
      const year = yearRaw ? parseInt(yearRaw, 10) : null;
      const doi = tag(e, "prism:doi") || tag(e, "doi");
      const link = (e.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] || tag(e, "article_link");

      papers.push({
        id: doi ? `doi:${doi}` : `jstage:${(link || title).slice(-60)}`,
        title,
        authors,
        year: Number.isFinite(year) ? year : null,
        doi: doi || null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: null,
        url: link || null,
        source: "jstage",
        venue: stripHtml(enJournal || jaJournal || "J-STAGE"),
        volume: tag(e, "prism:volume") || null,
        issue: tag(e, "prism:number") || null,
        pages: tag(e, "prism:startingPage")
          ? `${tag(e, "prism:startingPage")}${tag(e, "prism:endingPage") ? `-${tag(e, "prism:endingPage")}` : ""}`
          : null,
        publisher: "Japan Science and Technology Agency (J-STAGE)",
        type: "article",
        issn: tag(e, "prism:issn") || null,
        is_oa: true,
      });
    }

    const totalRaw = tag(xml, "opensearch:totalResults") || tag(xml, "totalResults");
    const total = totalRaw ? parseInt(totalRaw, 10) : papers.length;
    return { papers, total: Number.isFinite(total) ? total : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[jstage] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchJstage };
