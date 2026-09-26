/**
 * OSTI.GOV — U.S. Department of Energy Office of Scientific and Technical
 * Information. ~3M records: DOE technical reports, DOE PAGES accepted
 * manuscripts, conference papers, theses. Energy, materials, nuclear,
 * physics, engineering — the biggest domain this registry was missing.
 * Free, no API key.
 * Docs: https://www.osti.gov/api/v1/docs
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "osti";
export const name = "OSTI.GOV (U.S. Dept. of Energy — technical reports & DOE PAGES)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["energy", "physics", "materials", "engineering", "nuclear", "chemistry", "open_access"];

const API = "https://www.osti.gov/api/v1/records";

const mmddyyyy = (year, endOfYear) => (endOfYear ? `12/31/${year}` : `01/01/${year}`);

function pickLink(links, ...types) {
  for (const t of types) {
    const hit = (links || []).find((l) => String(l?.rel || l?.type || "").toLowerCase() === t);
    if (hit?.href) return hit.href;
  }
  return null;
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({ q: query, rows: String(Math.min(limit, 100)), page: "1" });
  if (year_min) params.set("publication_date_start", mmddyyyy(year_min, false));
  if (year_max) params.set("publication_date_end", mmddyyyy(year_max, true));

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const rows = await resp.json();
    const list = Array.isArray(rows) ? rows : rows?.records || [];

    const papers = list.slice(0, limit).map((r) => {
      const year = r.publication_date ? parseInt(String(r.publication_date).slice(0, 4), 10) : null;
      const fullText = pickLink(r.links, "fulltext", "citation");
      const authors = Array.isArray(r.authors)
        ? r.authors.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean)
        : [];
      return {
        id: r.doi ? `doi:${r.doi}` : `osti:${r.osti_id}`,
        title: stripHtml(r.title || ""),
        authors,
        year: Number.isFinite(year) ? year : null,
        doi: r.doi || null,
        arxiv_id: null,
        abstract: r.description ? stripHtml(r.description) : null,
        citation_count: null,
        pdf_url: fullText || null,
        url: r.links?.[0]?.href || `https://www.osti.gov/biblio/${r.osti_id}`,
        source: "osti",
        venue: r.journal_name || r.product_type || "OSTI.GOV (U.S. DOE)",
        volume: r.journal_volume || null,
        issue: r.journal_issue || null,
        pages: null,
        publisher: r.research_org || "U.S. Department of Energy",
        type: r.journal_name ? "article" : "policy_report",
        issn: r.journal_issn || null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    // The total count lives in the X-Total-Count response header.
    const hdr = parseInt(resp.headers?.get?.("x-total-count") || "", 10);
    return { papers, total: Number.isFinite(hdr) ? hdr : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[osti] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchOsti };
