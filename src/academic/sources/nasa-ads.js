/**
 * NASA ADS (Astrophysics Data System) — astronomy, astrophysics, planetary
 * science, and physics. Free API but requires a personal token.
 * Get one at https://ui.adsabs.harvard.edu/user/settings/token
 * Docs: https://ui.adsabs.harvard.edu/help/api/
 */

import { withTimeout } from "./_ojs.js";

export const id = "nasa_ads";
export const name = "NASA ADS (Astrophysics Data System)";
export const requiresKey = true;
export const keyEnvVar = "ADS_API_KEY";
export const domains = ["astronomy", "astrophysics", "physics", "planetary_science", "earth_science"];

const API = "https://api.adsabs.harvard.edu/v1/search/query";
const FL = "bibcode,title,author,year,doi,abstract,citation_count,pub,volume,issue,page,identifier,esources,property";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;
  const key = config.adsApiKey || process.env.ADS_API_KEY;
  if (!key) return { papers: [], total: 0 };

  let q = query;
  if (year_min || year_max) q += ` year:[${year_min || "*"} TO ${year_max || "*"}]`;

  const params = new URLSearchParams({
    q,
    fl: FL,
    rows: String(Math.min(limit, 100)),
    sort: sort === "citations" ? "citation_count desc" : sort === "recency" ? "date desc" : "score desc",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    const papers = docs.slice(0, limit).map((d) => {
      const arxivId = (d.identifier || []).map(String).find((i) => /^arxiv:/i.test(i))?.replace(/^arxiv:/i, "") || null;
      const isOa = (d.property || []).includes("OPENACCESS") || Boolean(arxivId);
      return {
        id: d.doi?.[0] ? `doi:${d.doi[0]}` : `nasa_ads:${d.bibcode}`,
        title: Array.isArray(d.title) ? d.title[0] : d.title || "",
        authors: (d.author || []).slice(0, 10),
        year: d.year ? parseInt(d.year, 10) : null,
        doi: d.doi?.[0] || null,
        arxiv_id: arxivId,
        abstract: d.abstract || null,
        citation_count: d.citation_count ?? null,
        pdf_url: arxivId
          ? `https://arxiv.org/pdf/${arxivId.replace(/v\d+$/, "")}.pdf`
          : isOa ? `https://ui.adsabs.harvard.edu/link_gateway/${d.bibcode}/PUB_PDF` : null,
        url: `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(d.bibcode)}/abstract`,
        source: "nasa_ads",
        venue: d.pub || "NASA ADS",
        volume: d.volume || null,
        issue: d.issue || null,
        pages: Array.isArray(d.page) ? d.page[0] : d.page || null,
        publisher: null,
        type: "article",
        issn: null,
        is_oa: isOa,
      };
    }).filter((p) => p.title);

    return { papers, total: data?.response?.numFound ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[nasa_ads] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchNasaAds };
