/**
 * NIH RePORTER — funded U.S. biomedical research projects.
 *
 * Not a literature source: it answers "who is funded to work on this, with
 * how much money, and at which institution", which is the landscape step of a
 * research loop rather than the citation step. Free, no key.
 * Docs: https://api.reporter.nih.gov/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "nih_reporter";
export const name = "NIH RePORTER (funded biomedical projects & grants)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["biomedical", "medicine", "funding", "research_landscape"];

const API = "https://api.reporter.nih.gov/v2/projects/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  const criteria = {
    advanced_text_search: {
      operator: "and",
      search_field: "projecttitle,abstracttext,terms",
      search_text: query,
    },
  };
  if (year_min || year_max) {
    const from = year_min || 1985;
    const to = year_max || new Date().getFullYear();
    criteria.fiscal_years = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).slice(0, 40);
  }

  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      body: JSON.stringify({ criteria, limit: Math.min(limit, 100), offset: 0 }),
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = (data?.results || []).slice(0, limit).map((r) => {
      const pis = (r.principal_investigators || []).map((p) => p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ")).filter(Boolean);
      const amount = r.award_amount != null ? `US$${Number(r.award_amount).toLocaleString("en-US")}` : null;
      return {
        id: `nih_reporter:${r.project_num || r.core_project_num}`,
        title: stripHtml(r.project_title || ""),
        authors: pis,
        year: r.fiscal_year ?? null,
        doi: null,
        arxiv_id: null,
        abstract: r.abstract_text ? stripHtml(r.abstract_text) : null,
        citation_count: null,
        pdf_url: null,
        url: r.project_detail_url || `https://reporter.nih.gov/project-details/${r.appl_id}`,
        source: "nih_reporter",
        venue: [r.organization?.org_name, amount].filter(Boolean).join(" — ") || "NIH RePORTER",
        volume: null,
        issue: null,
        pages: null,
        publisher: r.agency_ic_admin?.name || "U.S. National Institutes of Health",
        type: "grant",
        issn: null,
        is_oa: true,
        award_amount: r.award_amount ?? null,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.meta?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[nih_reporter] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchNihReporter };
