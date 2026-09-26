/**
 * GovInfo (U.S. Government Publishing Office) — Congressional reports and
 * hearings, the Federal Register, CFR, GAO reports, court opinions. The
 * authoritative source for U.S. regulation and legislative history.
 * Free api.data.gov key: https://api.data.gov/signup/
 * Docs: https://api.govinfo.gov/docs/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "govinfo";
export const name = "GovInfo (U.S. GPO — luật, quy định, báo cáo Quốc hội)";
export const requiresKey = true;
export const keyEnvVar = "GOVINFO_API_KEY";
export const domains = ["policy", "law", "regulation", "government", "social_science"];

const API = "https://api.govinfo.gov/search";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const key = config.govinfoApiKey || process.env.GOVINFO_API_KEY;
  if (!key) return { papers: [], total: 0 };

  let q = query;
  if (year_min || year_max) {
    q += ` publishdate:range(${year_min || 1900}-01-01,${year_max || 3000}-12-31)`;
  }

  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        "X-Api-Key": key, "User-Agent": "academic-search-mcp/2.0",
      },
      body: JSON.stringify({
        query: q,
        pageSize: Math.min(limit, 100),
        offsetMark: "*",
        sorts: [{ field: "score", sortOrder: "DESC" }],
      }),
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = (data?.results || []).slice(0, limit).map((r) => {
      const year = r.dateIssued ? parseInt(String(r.dateIssued).slice(0, 4), 10) : null;
      return {
        id: `govinfo:${r.packageId}`,
        title: stripHtml(r.title || ""),
        authors: [],
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        // Deliberately NOT appending ?api_key=... — the key would leak into
        // results, citations and logs. GovInfo PDFs need the key at download
        // time; the landing page below is always openable.
        pdf_url: null,
        url: r.packageLink || (r.packageId ? `https://www.govinfo.gov/app/details/${r.packageId}` : null),
        source: "govinfo",
        venue: r.collectionName || "U.S. Government Publishing Office",
        volume: null,
        issue: null,
        pages: null,
        publisher: "U.S. Government Publishing Office (GPO)",
        type: "policy_report",
        issn: null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.count ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[govinfo] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchGovinfo };
