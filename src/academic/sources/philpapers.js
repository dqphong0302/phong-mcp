/**
 * PhilPapers — the comprehensive index of philosophy research (journals,
 * books, chapters, preprints), the main humanities gap in this registry.
 *
 * Requires a free API id + key issued to registered users:
 * https://philpapers.org/help/api  → set PHILPAPERS_API_KEY (and
 * PHILPAPERS_API_ID if your id differs from the key).
 *
 * NOTE: this endpoint could not be exercised against the live service when
 * written; it stays inert until a key is configured, so a wrong assumption
 * here cannot affect existing searches. Verify on first real run.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "philpapers";
export const name = "PhilPapers (philosophy & humanities)";
export const requiresKey = true;
export const keyEnvVar = "PHILPAPERS_API_KEY";
export const domains = ["philosophy", "humanities", "ethics", "social_science"];

const API = "https://philpapers.org/philpapers/raw/search.json";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const apiKey = config.philpapersApiKey || process.env.PHILPAPERS_API_KEY;
  if (!apiKey) return { papers: [], total: 0 };
  const apiId = process.env.PHILPAPERS_API_ID || apiKey;

  const params = new URLSearchParams({
    searchStr: query,
    apiId,
    apiKey,
    limit: String(Math.min(limit, 100)),
    format: "json",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const rows = data?.entries || data?.results || (Array.isArray(data) ? data : []);

    const papers = [];
    for (const e of rows) {
      if (papers.length >= limit) break;
      const title = stripHtml(e.title || "");
      if (!title) continue;
      const year = e.year ? parseInt(String(e.year), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }
      papers.push({
        id: e.doi ? `doi:${e.doi}` : `philpapers:${e.id}`,
        title,
        authors: Array.isArray(e.authors) ? e.authors.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean) : [],
        year: Number.isFinite(year) ? year : null,
        doi: e.doi || null,
        arxiv_id: null,
        abstract: e.abstract ? stripHtml(e.abstract) : null,
        citation_count: null,
        pdf_url: e.pub_link && /\.pdf/i.test(e.pub_link) ? e.pub_link : null,
        url: e.link || (e.id ? `https://philpapers.org/rec/${e.id}` : null),
        source: "philpapers",
        venue: e.journal || e.pub_name || "PhilPapers",
        volume: e.volume || null,
        issue: e.issue || null,
        pages: e.pages || null,
        publisher: e.publisher || null,
        type: String(e.pub_type || "").toLowerCase().includes("book") ? "book" : "article",
        issn: null,
        is_oa: Boolean(e.oa || e.pub_link),
      });
    }

    return { papers, total: data?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[philpapers] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchPhilpapers };
