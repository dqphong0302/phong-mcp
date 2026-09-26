/**
 * PLOS Search API — Solr full-text search across the entire PLOS corpus
 * (PLOS ONE, Biology, Medicine, Computational Biology, ...). Everything is
 * CC-BY Open Access. Free, no key.
 * Rate limits: 10 req/min, 300/hour, 7200/day, max 100 rows per request.
 * Docs: https://api.plos.org/solr/faq/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "plos";
export const name = "PLOS (full-text search, 100% Open Access)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["biomedical", "biology", "medicine", "computational_biology", "open_access"];

const API = "https://api.plos.org/search";
const FL = "id,title_display,author_display,abstract,publication_date,journal,article_type,counter_total_all";

/** Journal → site path, needed to build a working full-text PDF link. */
const JOURNAL_PATH = {
  "plos one": "plosone",
  "plos biology": "plosbiology",
  "plos medicine": "plosmedicine",
  "plos computational biology": "ploscompbiol",
  "plos genetics": "plosgenetics",
  "plos pathogens": "plospathogens",
  "plos neglected tropical diseases": "plosntds",
  "plos global public health": "globalpublichealth",
  "plos digital health": "digitalhealth",
  "plos climate": "climate",
  "plos water": "water",
  "plos mental health": "mentalhealth",
  "plos complex systems": "complexsystems",
  "plos sustainability and transformation": "sustainabilitytransformation",
};

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;

  let q = `everything:"${String(query).replace(/"/g, "")}"`;
  if (year_min || year_max) {
    const from = year_min ? `${year_min}-01-01T00:00:00Z` : "*";
    const to = year_max ? `${year_max}-12-31T23:59:59Z` : "*";
    q += ` AND publication_date:[${from} TO ${to}]`;
  }
  // Exclude corrections / front matter, which otherwise dominate keyword hits.
  q += ' AND doc_type:full AND -article_type:"Correction"';

  const params = new URLSearchParams({
    q,
    wt: "json",
    fl: FL,
    rows: String(Math.min(limit, 100)),
  });
  if (sort === "recency") params.set("sort", "publication_date desc");

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    const papers = docs.slice(0, limit).map((d) => {
      const doi = d.id;
      const year = d.publication_date ? parseInt(String(d.publication_date).slice(0, 4), 10) : null;
      const abstract = Array.isArray(d.abstract) ? stripHtml(d.abstract.join(" ")) : d.abstract ? stripHtml(d.abstract) : null;
      return {
        id: `doi:${doi}`,
        title: stripHtml(Array.isArray(d.title_display) ? d.title_display[0] : d.title_display || ""),
        authors: d.author_display || [],
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: null,
        abstract: abstract || null,
        citation_count: null,
        pdf_url: `https://journals.plos.org/${JOURNAL_PATH[String(d.journal || "").toLowerCase()] || "plosone"}/article/file?id=${doi}&type=printable`,
        url: `https://doi.org/${doi}`,
        source: "plos",
        venue: d.journal || "PLOS",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Public Library of Science (PLOS)",
        type: String(d.article_type || "").toLowerCase().includes("research") ? "article" : "article",
        issn: null,
        is_oa: true,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.response?.numFound ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[plos] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchPlos };
