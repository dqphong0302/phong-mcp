/**
 * Epistemonikos — the largest database of systematic reviews and their
 * included primary studies, curated by humans rather than harvested.
 *
 * This is the piece the PRISMA / meta-analysis / risk-of-bias tools in this
 * service were missing: PubMed and Europe PMC tell you what was published,
 * Epistemonikos tells you what has already been *synthesised*, so a review
 * does not get redone from scratch.
 *
 * Requires an access token issued to registered clients (free for research —
 * write to dev@epistemonikos.org). Set EPISTEMONIKOS_TOKEN.
 * Docs: https://api.epistemonikos.org/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "epistemonikos";
export const name = "Epistemonikos (tổng quan hệ thống & bằng chứng đã tổng hợp)";
export const requiresKey = true;
export const keyEnvVar = "EPISTEMONIKOS_TOKEN";
export const domains = ["biomedical", "medicine", "evidence_based", "systematic_review", "clinical"];

const API = "https://api.epistemonikos.org/v1";

/** Epistemonikos `classification` → this registry's paper `type`. */
const TYPE_MAP = {
  "systematic-review": "systematic_review",
  "systematic_review": "systematic_review",
  "overview": "review",
  "structured-summary-of-systematic-review": "review",
  "primary-study": "article",
  "primary_study": "article",
  "broad-synthesis": "review",
};

function pickLang(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  // Multilingual fields arrive as { en: "...", es: "..." }
  return v.en || v.eng || Object.values(v).find((x) => typeof x === "string") || null;
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;
  const token = config.epistemonikosToken || process.env.EPISTEMONIKOS_TOKEN;
  if (!token) return { papers: [], total: 0 };

  const params = new URLSearchParams({ q: query });
  if (sort === "recency") params.set("sort", "year");

  try {
    const resp = await fetch(`${API}/documents/search?${params}`, {
      headers: {
        Accept: "application/json",
        Authentication: token,
        "User-Agent": "academic-search-mcp/2.0",
      },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const rows = data?.documents || data?.results || (Array.isArray(data) ? data : []);

    const papers = [];
    for (const d of rows) {
      if (papers.length >= limit) break;
      const title = stripHtml(pickLang(d.title) || "");
      if (!title) continue;

      const yr = parseInt(String(d.year ?? d.publication_year ?? ""), 10);
      const year = Number.isFinite(yr) ? yr : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const doi = String(d.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim() || null;
      const cls = String(d.classification || d.publication_type || "").toLowerCase();

      papers.push({
        id: doi ? `doi:${doi}` : `epistemonikos:${d.id || d._id}`,
        title,
        authors: Array.isArray(d.authors)
          ? d.authors.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean)
          : [],
        year,
        doi,
        arxiv_id: null,
        abstract: pickLang(d.abstract) ? stripHtml(pickLang(d.abstract)) : null,
        citation_count: null,
        pdf_url: null,
        url: d.url || (doi ? `https://doi.org/${doi}` : d.id ? `https://www.epistemonikos.org/en/documents/${d.id}` : null),
        source: "epistemonikos",
        venue: pickLang(d.journal) || pickLang(d.publication) || "Epistemonikos",
        volume: d.volume || null,
        issue: d.issue || null,
        pages: d.pages || null,
        publisher: null,
        type: TYPE_MAP[cls] || (cls.includes("review") ? "systematic_review" : "article"),
        issn: null,
        is_oa: false,
        classification: cls || null,
        pmid: d.pmid || null,
      });
    }

    return { papers, total: data?.total ?? data?.count ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[epistemonikos] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchEpistemonikos };
