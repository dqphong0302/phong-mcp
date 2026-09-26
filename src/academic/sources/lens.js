/**
 * Lens.org — combined scholarly + patent corpus with linkage between them
 * (which patents cite which papers). Free access token for non-commercial
 * research: https://www.lens.org/lens/user/subscriptions#scholar
 * Set LENS_API_TOKEN to enable.
 * Docs: https://docs.api.lens.org/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "lens";
export const name = "Lens.org (scholarly works + patent linkage)";
export const requiresKey = true;
export const keyEnvVar = "LENS_API_TOKEN";
export const domains = ["general", "patents", "innovation", "scientometrics"];

const API = "https://api.lens.org/scholarly/search";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const token = config.lensApiToken || process.env.LENS_API_TOKEN;
  if (!token) return { papers: [], total: 0 };

  const must = [{ query_string: { query, default_operator: "and" } }];
  if (year_min || year_max) {
    must.push({ range: { year_published: { gte: year_min || 1800, lte: year_max || 3000 } } });
  }

  const body = {
    query: { bool: { must } },
    size: Math.min(limit, 100),
    include: [
      "lens_id", "title", "authors", "year_published", "external_ids",
      "abstract", "scholarly_citations_count", "source", "volume", "issue", "start_page", "end_page", "publication_type",
    ],
  };

  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        Authorization: `Bearer ${token}`, "User-Agent": "academic-search-mcp/2.0",
      },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = (data?.data || []).slice(0, limit).map((w) => {
      const doi = (w.external_ids || []).find((e) => e.type === "doi")?.value || null;
      return {
        id: doi ? `doi:${doi}` : `lens:${w.lens_id}`,
        title: stripHtml(w.title || ""),
        authors: (w.authors || []).slice(0, 10)
          .map((a) => [a.first_name, a.last_name].filter(Boolean).join(" ").trim())
          .filter(Boolean),
        year: w.year_published ?? null,
        doi,
        arxiv_id: null,
        abstract: w.abstract ? stripHtml(w.abstract) : null,
        citation_count: w.scholarly_citations_count ?? null,
        pdf_url: null,
        url: doi ? `https://doi.org/${doi}` : `https://www.lens.org/lens/scholar/article/${w.lens_id}`,
        source: "lens",
        venue: w.source?.title || "Lens.org",
        volume: w.volume || null,
        issue: w.issue || null,
        pages: w.start_page ? `${w.start_page}${w.end_page ? `-${w.end_page}` : ""}` : null,
        publisher: w.source?.publisher || null,
        type: String(w.publication_type || "").toLowerCase().includes("conference") ? "conference" : "article",
        issn: w.source?.issn?.[0]?.value || null,
        is_oa: false,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[lens] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchLens };
