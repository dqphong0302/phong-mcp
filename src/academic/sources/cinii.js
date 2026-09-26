/**
 * CiNii Research (National Institute of Informatics, Japan) source plugin.
 * Free OpenSearch API, no key required.
 *
 * Covers millions of Japanese academic journal articles, dissertations,
 * research project reports (KAKEN), and institutional repositories.
 */

import { stripHtml } from "./_ojs.js";

export const id = "cinii";
export const name = "CiNii Research (NII Japan — Articles, Theses & Projects)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["science", "engineering", "medicine", "humanities", "social_science", "asia", "open_access"];
export const available = true;

const API_BASE = "https://cir.nii.ac.jp/opensearch/all";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  const params = new URLSearchParams({
    q: query,
    format: "json",
    count: String(Math.min(limit, 50)),
  });
  if (year_min) params.set("from", String(year_min));
  if (year_max) params.set("until", String(year_max));

  try {
    const resp = await fetch(`${API_BASE}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (Mozilla/5.0)",
      },
      signal: signal || AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const items = data.items || data["@graph"]?.[0]?.items || [];
    const total = data["opensearch:totalResults"] ? parseInt(data["opensearch:totalResults"], 10) : items.length;

    const papers = items.slice(0, limit).map((item) => {
      const title = stripHtml(item.title || "");
      const link = item.link?.["@id"] || item["@id"] || null;
      const creators = Array.isArray(item["dc:creator"])
        ? item["dc:creator"]
        : (item["dc:creator"] ? [item["dc:creator"]] : []);
      const dateStr = item["dc:date"] || item["prism:publicationDate"] || "";
      const year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;
      const doiObj = (item["dc:identifier"] || []).find?.((id) => id?.["@type"] === "cir:DOI" || id?.["@type"]?.includes("DOI"));
      const doi = doiObj ? doiObj["@value"]?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null;
      const venue = item["dc:source"]?.[0]?.["dc:title"] || item["prism:publicationName"] || "CiNii Research";
      const abstract = item.description ? stripHtml(item.description) : null;

      return {
        id: doi ? `doi:${doi}` : `cinii:${link?.split("/").pop() || title.slice(0, 30)}`,
        title,
        authors: creators.map((c) => (typeof c === "string" ? c : c["@value"] || "")).filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi: doi || null,
        arxiv_id: null,
        abstract,
        citation_count: null,
        pdf_url: null,
        url: link,
        source: "cinii",
        venue,
        volume: item["prism:volume"] || null,
        issue: item["prism:number"] || null,
        pages: item["prism:startingPage"] ? `${item["prism:startingPage"]}-${item["prism:endingPage"] || ""}` : null,
        publisher: "National Institute of Informatics (NII)",
        type: item["dc:type"] === "Project" ? "project" : "article",
        issn: item["prism:issn"] || null,
        is_oa: true,
      };
    });

    return {
      papers,
      total,
    };
  } catch {
    return { papers: [], total: 0 };
  }
}

export async function getById(id, _config = {}, opts = {}) {
  const cleanId = String(id).replace(/^cinii:/, "");
  try {
    const url = `https://cir.nii.ac.jp/crid/${encodeURIComponent(cleanId)}.json`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: opts.signal || AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data ? search(cleanId, { limit: 1 }, _config).then((r) => r.papers[0] || null) : null;
  } catch {
    return null;
  }
}
