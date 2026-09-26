/**
 * OSF Registries — registered study protocols and pre-registrations
 * (including a large share of systematic-review protocols).
 *
 * Why this and not PROSPERO: PROSPERO exposes no public API, so it cannot be
 * queried programmatically. OSF Registries is the largest freely queryable
 * protocol registry and serves the same purpose in a PRISMA workflow —
 * checking whether a review or study has already been registered before
 * starting one, and finding protocols whose results were never published
 * (the main lever against publication bias).
 *
 * Free JSON:API, no key. Docs: https://developer.osf.io/
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "osf_registries";
export const name = "OSF Registries (đề cương & tiền đăng ký nghiên cứu)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["open_science", "systematic_review", "social_science", "psychology", "evidence_based"];

const API = "https://api.osf.io/v2/registrations/";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const params = new URLSearchParams({
    "filter[title]": query,
    "page[size]": String(Math.min(limit, 100)),
    sort: "-date_registered",
    embed: "contributors",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/vnd.api+json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const item of data?.data || []) {
      if (papers.length >= limit) break;
      const a = item.attributes || {};
      const title = stripHtml(a.title || "");
      if (!title) continue;

      const dateRaw = a.date_registered || a.date_created;
      const yr = dateRaw ? parseInt(String(dateRaw).slice(0, 4), 10) : NaN;
      const year = Number.isFinite(yr) ? yr : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const authors = (item.embeds?.contributors?.data || [])
        .map((c) => c.embeds?.users?.data?.attributes?.full_name || c.attributes?.full_name)
        .filter(Boolean);

      papers.push({
        id: a.doi ? `doi:${a.doi}` : `osf_registries:${item.id}`,
        title,
        authors,
        year,
        doi: a.doi || null,
        arxiv_id: null,
        abstract: a.description ? stripHtml(a.description) : null,
        citation_count: null,
        pdf_url: null,
        url: `https://osf.io/${item.id}`,
        source: "osf_registries",
        venue: a.registration_supplement || "OSF Registries",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Center for Open Science",
        type: "protocol",
        issn: null,
        is_oa: true,
        withdrawn: Boolean(a.withdrawn),
      });
    }

    return { papers, total: data?.links?.meta?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[osf_registries] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchOsfRegistries };
