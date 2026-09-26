/**
 * Patent *literature* proxy, backed by OpenAlex — NOT the USPTO API.
 *
 * Despite the id, this plugin does not call PatentsView: it queries OpenAlex
 * and labels the hits as patent-related work. It is kept because it returns
 * useful prior-art literature, but it must not be presented as a patent
 * register. For real granted-patent records (patent number, inventors,
 * assignee, CPC) use the `patentsview` source, which calls the USPTO
 * PatentSearch API — note the old keyless api.patentsview.org endpoint was
 * shut down in early 2025 and a free API key is now required.
 *
 * Provides: U.S. Granted Patents, inventors, assignees, classifications, and grant dates.
 */

import { fromUsptoPatent } from "../formatter.js";

export const id = "uspto_patents";
export const name = "Patent literature via OpenAlex (prior art — không phải sổ đăng ký sáng chế)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["patents", "intellectual_property", "technology", "inventions"];

const OPENALEX_API = "https://api.openalex.org/works";

/**
 * Search Patents (USPTO, WIPO, EPO) via OpenAlex Patent Index.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;
  const perPage = Math.min(limit, 25);

  const params = new URLSearchParams({
    search: `${query.trim()} patent`,
    per_page: String(perPage),
  });

  if (year_min || year_max) {
    params.set("filter", `publication_year:${year_min || 1990}-${year_max || new Date().getFullYear()}`);
  }

  if (sort === "citations") params.set("sort", "cited_by_count:desc");
  else if (sort === "recency") params.set("sort", "publication_date:desc");
  else params.set("sort", "relevance_score:desc");

  try {
    const resp = await fetch(`${OPENALEX_API}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0 (mailto:phongdang@home-server.local)",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const results = data.results || [];
    const papers = results.map((work) => {
      const p = fromUsptoPatent({
        patent_number: work.doi ? work.doi.replace(/.*\//, "") : (work.id ? work.id.replace(/.*\//, "") : "PATENT"),
        patent_title: work.title || work.display_name,
        patent_date: work.publication_date,
        patent_abstract: work.abstract || work.description,
        inventors: (work.authorships || []).map((a) => ({
          inventor_first_name: a.author?.display_name || "",
          inventor_last_name: "",
        })),
        assignees: (work.institutions || []).map((i) => ({ assignee_organization: i.display_name })),
      });
      return {
        ...p,
        url: work.doi ? `https://doi.org/${work.doi.replace("https://doi.org/", "")}` : (work.primary_location?.landing_page_url || `https://patents.google.com/?q=${encodeURIComponent(query)}`),
      };
    });

    return {
      papers: papers.slice(0, limit),
      total: data.meta?.count || papers.length,
    };
  } catch (err) {
    console.warn("[uspto_patents] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(id, _config = {}) {
  const cleanId = id.replace(/^uspto_patents:/i, "").replace(/^openalex:/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = cleanId.startsWith("http") ? cleanId : `${OPENALEX_API}/${cleanId}`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0 (mailto:phongdang@home-server.local)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const work = await resp.json();
    return fromUsptoPatent({
      patent_number: work.doi ? work.doi.replace(/.*\//, "") : (work.id ? work.id.replace(/.*\//, "") : "PATENT"),
      patent_title: work.title || work.display_name,
      patent_date: work.publication_date,
      patent_abstract: work.abstract || work.description,
      inventors: (work.authorships || []).map((a) => ({
        inventor_first_name: a.author?.display_name || "",
        inventor_last_name: "",
      })),
      assignees: (work.institutions || []).map((i) => ({ assignee_organization: i.display_name })),
    });
  } catch {
    return null;
  }
}

export { search as searchUsptoPatents };
