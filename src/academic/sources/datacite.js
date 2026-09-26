/**
 * DataCite — the DOI registry for research data, software and preprints.
 * Complements Zenodo/Dataverse by covering every DataCite member repository
 * at once. Free JSON:API, no key.
 * Docs: https://support.datacite.org/docs/api
 */

import { withTimeout } from "./_ojs.js";

export const id = "datacite";
export const name = "DataCite (research data, software & preprint DOIs)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "software", "open_science", "open_access"];

const API = "https://api.datacite.org/dois";

const TYPE_MAP = { dataset: "dataset", software: "software", text: "article", preprint: "preprint" };

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    query,
    "page[size]": String(Math.min(limit, 100)),
  });
  if (year_min || year_max) {
    params.set("query", `${query} AND publicationYear:[${year_min || "*"} TO ${year_max || "*"}]`);
  }

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/vnd.api+json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = (data?.data || []).slice(0, limit).map((item) => {
      const a = item.attributes || {};
      const resType = String(a.types?.resourceTypeGeneral || "").toLowerCase();
      const pdf = (a.contentUrl || []).find((u) => /\.pdf($|\?)/i.test(u)) || null;
      return {
        id: `doi:${a.doi}`,
        title: (a.titles || [])[0]?.title || "",
        authors: (a.creators || []).slice(0, 10).map((c) => c.name || [c.givenName, c.familyName].filter(Boolean).join(" ")).filter(Boolean),
        year: a.publicationYear ?? null,
        doi: a.doi || null,
        arxiv_id: null,
        abstract: (a.descriptions || []).find((d) => d.descriptionType === "Abstract")?.description || null,
        citation_count: a.citationCount ?? null,
        pdf_url: pdf,
        url: a.url || (a.doi ? `https://doi.org/${a.doi}` : null),
        source: "datacite",
        venue: a.publisher?.name || a.publisher || "DataCite",
        volume: null,
        issue: null,
        pages: null,
        publisher: a.publisher?.name || a.publisher || null,
        type: TYPE_MAP[resType] || "other",
        issn: null,
        is_oa: String(a.rightsList?.[0]?.rightsIdentifier || "").toLowerCase().includes("cc") || Boolean(pdf),
      };
    }).filter((p) => p.title);

    return { papers, total: data?.meta?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[datacite] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchDatacite };
