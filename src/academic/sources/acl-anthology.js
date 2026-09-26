/**
 * ACL Anthology / NLP Focused Academic Source Plugin.
 * Free, no API key required.
 *
 * Targets NLP & LLM peer-reviewed venues:
 * ACL, EMNLP, NAACL, EACL, COLING, CoNLL, TACL, Computational Linguistics.
 * Powered via OpenAlex venue-targeted querying.
 */

import { fromAclAnthology } from "../formatter.js";

export const id = "acl_anthology";
export const name = "ACL Anthology (NLP & LLM Papers)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["nlp", "llm", "ai", "computational_linguistics", "speech"];

const S2_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const OPENALEX_API = "https://api.openalex.org/works";

/**
 * Search ACL Anthology / NLP Venues via Semantic Scholar & OpenAlex.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [config]
 */
export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  // 1. Try Semantic Scholar venue filter first (very accurate for ACL/EMNLP/NAACL)
  try {
    const s2Params = new URLSearchParams({
      query,
      venue: "ACL,EMNLP,NAACL,EACL,CoNLL,TACL,Findings,Computational Linguistics",
      limit: String(Math.min(limit * 2, 30)),
      fields: "title,authors,year,abstract,citationCount,openAccessPdf,venue,url,externalIds,publicationDate",
    });

    if (year_min || year_max) {
      s2Params.set("year", `${year_min || 2018}-${year_max || new Date().getFullYear()}`);
    }

    const headers = { Accept: "application/json" };
    if (config.semanticScholarApiKey) {
      headers["x-api-key"] = config.semanticScholarApiKey;
    }

    const resp = await fetch(`${S2_URL}?${s2Params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const s2Papers = (data.data || []).map((p) => {
        const authors = (p.authors || []).slice(0, 6).map((a) => a.name).filter(Boolean);
        const doi = p.externalIds?.DOI || null;
        const arxivId = p.externalIds?.ArXiv || null;
        return {
          id: doi ? `doi:${doi}` : (arxivId ? `arxiv:${arxivId}` : `s2:${p.paperId}`),
          title: p.title || "(untitled)",
          authors,
          year: p.year || null,
          doi,
          arxiv_id: arxivId,
          abstract: p.abstract || null,
          citation_count: p.citationCount || null,
          pdf_url: p.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null),
          url: p.url || (doi ? `https://doi.org/${doi}` : null),
          source: "acl_anthology",
          venue: p.venue || "Association for Computational Linguistics (ACL)",
          tldr: null,
          volume: null,
          issue: null,
          pages: null,
          publisher: "Association for Computational Linguistics",
          type: "conference",
          issn: null,
          is_oa: true,
        };
      });

      if (s2Papers.length > 0) {
        if (sort === "citations") s2Papers.sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0));
        else if (sort === "recency") s2Papers.sort((a, b) => (b.year || 0) - (a.year || 0));
        return {
          papers: s2Papers.slice(0, limit),
          total: data.total || s2Papers.length,
        };
      }
    }
  } catch (err) {
    // fallback to OpenAlex
  }

  // 2. Fallback: OpenAlex with pipe syntax for OR
  try {
    const filters = [
      "locations.source.display_name.search:ACL|EMNLP|NAACL|Computational Linguistics",
    ];
    if (year_min || year_max) {
      filters.push(`publication_year:${year_min || 2018}-${year_max || new Date().getFullYear()}`);
    }

    const params = new URLSearchParams({
      search: `${query} ACL`,
      per_page: String(Math.min(limit, 25)),
    });

    const resp = await fetch(`${OPENALEX_API}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0 (mailto:phongdang@home-server.local)",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const papers = (data.results || []).map(fromAclAnthology);

    return {
      papers: papers.slice(0, limit),
      total: data.meta?.count || papers.length,
    };
  } catch (err) {
    console.warn("[acl_anthology] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchAclAnthology };
