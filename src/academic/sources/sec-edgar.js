/**
 * SEC EDGAR full-text search — U.S. company filings (10-K, 10-Q, 8-K, S-1...).
 * Primary-source material for finance, accounting, corporate governance and
 * industry research. Free, no key, but the SEC requires a descriptive
 * User-Agent with a contact address (set SEC_EDGAR_CONTACT).
 * Docs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "sec_edgar";
export const name = "SEC EDGAR (U.S. company filings, full-text)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["finance", "economics", "business", "accounting", "policy"];

const API = "https://efts.sec.gov/LATEST/search-index";
const CONTACT = process.env.SEC_EDGAR_CONTACT || process.env.UNPAYWALL_EMAIL || "research@example.com";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({ q: `"${String(query).replace(/"/g, "")}"` });
  if (year_min) params.set("startdt", `${year_min}-01-01`);
  if (year_max) params.set("enddt", `${year_max}-12-31`);

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: {
        Accept: "application/json",
        // SEC blocks generic agents; a contact address is mandatory.
        "User-Agent": `academic-search-mcp/2.0 (${CONTACT})`,
      },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const hits = data?.hits?.hits || [];

    const papers = hits.slice(0, limit).map((h) => {
      const s = h._source || {};
      const year = s.file_date ? parseInt(String(s.file_date).slice(0, 4), 10) : null;
      // _id looks like "0000320193-23-000106:aapl-20230930.htm"
      const [accRaw, file] = String(h._id || "").split(":");
      const acc = (accRaw || "").replace(/-/g, "");
      const cik = (s.ciks || [])[0];
      const url = cik && acc && file
        ? `https://www.sec.gov/Archives/edgar/data/${String(cik).replace(/^0+/, "")}/${acc}/${file}`
        : "https://www.sec.gov/cgi-bin/srqsb";
      const company = (s.display_names || [])[0] || null;

      return {
        id: `sec_edgar:${h._id}`,
        title: [s.form ? `[${s.form}]` : null, company, s.file_date].filter(Boolean).join(" ") || stripHtml(file || ""),
        authors: company ? [company] : [],
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: null,
        url,
        source: "sec_edgar",
        venue: `SEC EDGAR — ${s.form || "filing"}`,
        volume: null,
        issue: null,
        pages: null,
        publisher: "U.S. Securities and Exchange Commission",
        type: "policy_report",
        issn: null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.hits?.total?.value ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[sec_edgar] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchSecEdgar };
