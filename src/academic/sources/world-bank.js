/**
 * World Bank Documents & Reports (Open Knowledge Repository).
 * Development economics, policy and country studies — the grey-literature
 * counterpart to WHO IRIS. Free JSON API, no key, everything is OA.
 * Docs: https://documents.worldbank.org/en/publication/documents-reports/api
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "world_bank";
export const name = "World Bank Open Knowledge Repository (Documents & Reports)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["economics", "development", "policy", "social_science", "open_access"];

const API = "https://search.worldbank.org/api/v2/wds";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    format: "json",
    qterm: query,
    rows: String(Math.min(limit, 100)),
    fl: "docdt,docna,display_title,pdfurl,url_friendly_title,count,authr,repnb,owner,abstracts",
  });
  if (year_min) params.set("strdate", `${year_min}-01-01`);
  if (year_max) params.set("enddate", `${year_max}-12-31`);

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const docs = data?.documents || {};
    const papers = [];
    for (const [key, d] of Object.entries(docs)) {
      if (key === "facets" || !d || typeof d !== "object") continue;
      if (papers.length >= limit) break;

      const title = stripHtml(d.display_title || d.docna || "");
      if (!title) continue;
      const year = d.docdt ? parseInt(String(d.docdt).slice(0, 4), 10) : null;

      let abstract = null;
      if (d.abstracts) {
        const first = Object.values(d.abstracts)[0];
        abstract = stripHtml(typeof first === "string" ? first : first?.cdata || "") || null;
      }

      papers.push({
        id: `world_bank:${key}`,
        title,
        authors: d.authr ? String(d.authr).split(/;/).map((a) => a.trim()).filter(Boolean) : [],
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract,
        citation_count: null,
        pdf_url: d.pdfurl || null,
        url: d.url_friendly_title || d.guid || d.pdfurl || null,
        source: "world_bank",
        venue: "World Bank Documents & Reports",
        volume: null,
        issue: null,
        pages: null,
        publisher: d.owner || "The World Bank",
        type: "policy_report",
        issn: null,
        is_oa: true,
      });
    }

    const total = parseInt(data?.total, 10);
    return { papers, total: Number.isFinite(total) ? total : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[world_bank] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchWorldBank };
