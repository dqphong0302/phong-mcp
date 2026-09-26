/**
 * NTRS — NASA Technical Reports Server. Aerospace, propulsion, materials,
 * structures, control systems, planetary science. ~1M citations, most with
 * a free PDF. Free public API, no key.
 * Docs: https://ntrs.nasa.gov/api/openapi/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "ntrs";
export const name = "NASA NTRS (Technical Reports Server)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["aerospace", "engineering", "materials", "physics", "planetary_science", "open_access"];

const API = "https://ntrs.nasa.gov/api/citations/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({ q: query, "page.size": String(Math.min(limit, 100)), "page.from": "0" });
  if (year_min) params.set("published.gte", `${year_min}-01-01`);
  if (year_max) params.set("published.lte", `${year_max}-12-31`);

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const rows = data?.results || (Array.isArray(data) ? data : []);

    const papers = [];
    for (const r of rows) {
      if (papers.length >= limit) break;
      const title = stripHtml(r.title || "");
      if (!title) continue;

      const dateRaw = r.published || r.created || r.distributionDate || r.publications?.[0]?.publicationDate;
      const year = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const pdf = (r.downloads || []).find((d) => /pdf/i.test(d?.mimetype || d?.type || "") || /\.pdf/i.test(d?.links?.original || ""));
      const pdfPath = pdf?.links?.original || pdf?.links?.pdf || null;

      papers.push({
        id: r.id ? `ntrs:${r.id}` : `ntrs:${title.slice(0, 40)}`,
        title,
        authors: (r.authorAffiliations || []).map((a) => a?.meta?.author?.name).filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi: r.publications?.[0]?.doi || null,
        arxiv_id: null,
        abstract: r.abstract ? stripHtml(r.abstract) : null,
        citation_count: null,
        pdf_url: pdfPath ? (pdfPath.startsWith("http") ? pdfPath : `https://ntrs.nasa.gov${pdfPath}`) : null,
        url: r.id ? `https://ntrs.nasa.gov/citations/${r.id}` : null,
        source: "ntrs",
        venue: r.publications?.[0]?.publicationName || "NASA Technical Reports Server",
        volume: null,
        issue: null,
        pages: null,
        publisher: r.center?.name || "National Aeronautics and Space Administration (NASA)",
        type: String(r.stiTypeDetails || r.stiType || "").toLowerCase().includes("conference") ? "conference" : "policy_report",
        issn: null,
        is_oa: Boolean(pdfPath),
      });
    }

    const total = data?.stats?.total ?? data?.total;
    return { papers, total: Number.isFinite(total) ? total : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[ntrs] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchNtrs };
