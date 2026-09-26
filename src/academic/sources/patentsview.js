/**
 * PatentsView PatentSearch API — real USPTO patent data (granted patents,
 * inventors, assignees, CPC classes).
 *
 * IMPORTANT: the legacy keyless endpoint api.patentsview.org was shut down in
 * early 2025. The current API requires a free API key, requested at
 * https://patentsview-support.atlassian.net/servicedesk/customer/portals
 * Set PATENTSVIEW_API_KEY to enable this source.
 *
 * Docs: https://search.patentsview.org/docs/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "patentsview";
export const name = "PatentsView / USPTO PatentSearch (granted patents)";
export const requiresKey = true;
export const keyEnvVar = "PATENTSVIEW_API_KEY";
export const domains = ["patents", "engineering", "technology", "innovation"];

const API = "https://search.patentsview.org/api/v1/patent/";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const key = config.patentsviewApiKey || process.env.PATENTSVIEW_API_KEY;
  if (!key) return { papers: [], total: 0 };

  const conditions = [{ _text_any: { patent_title: query } }];
  if (year_min) conditions.push({ _gte: { patent_date: `${year_min}-01-01` } });
  if (year_max) conditions.push({ _lte: { patent_date: `${year_max}-12-31` } });

  const params = new URLSearchParams({
    q: JSON.stringify(conditions.length > 1 ? { _and: conditions } : conditions[0]),
    f: JSON.stringify([
      "patent_id", "patent_title", "patent_date", "patent_abstract",
      "patent_type", "inventors.inventor_name_first", "inventors.inventor_name_last",
      "assignees.assignee_organization",
    ]),
    o: JSON.stringify({ size: Math.min(limit, 100) }),
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "X-Api-Key": key, "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = (data?.patents || []).slice(0, limit).map((p) => {
      const year = p.patent_date ? parseInt(String(p.patent_date).slice(0, 4), 10) : null;
      const inventors = (p.inventors || [])
        .map((i) => [i.inventor_name_first, i.inventor_name_last].filter(Boolean).join(" ").trim())
        .filter(Boolean);
      const assignee = (p.assignees || [])[0]?.assignee_organization || null;
      return {
        id: `patentsview:${p.patent_id}`,
        title: stripHtml(p.patent_title || ""),
        authors: inventors,
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract: p.patent_abstract ? stripHtml(p.patent_abstract) : null,
        citation_count: null,
        pdf_url: null,
        url: `https://patents.google.com/patent/US${p.patent_id}`,
        source: "patentsview",
        venue: assignee ? `USPTO — ${assignee}` : "United States Patent and Trademark Office",
        volume: null,
        issue: null,
        pages: null,
        publisher: assignee || "USPTO",
        type: "patent",
        issn: null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.total_hits ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[patentsview] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchPatentsview };
