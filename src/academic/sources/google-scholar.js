/**
 * Google Scholar, via this stack's medical-sidecar (GET /google-scholar?q=).
 *
 * Scholar has no API; the sidecar scrapes the results page through the
 * configured proxy. It is the only source here that indexes theses, book
 * chapters, working papers and non-English regional journals in one place —
 * useful precisely where OpenAlex and Crossref are thin.
 *
 * Caveats, deliberately not hidden:
 *  - Scholar serves CAPTCHAs to datacentre IPs; the sidecar returns 500 and
 *    this plugin then returns an empty result rather than partial garbage.
 *  - The results page carries no DOI, no abstract and no clean author list.
 *    Authors/venue/year are parsed from the grey byline ("A Nguyen, B Tran -
 *    Journal of X, 2021 - publisher.com") and left empty when unparseable —
 *    never invented.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "google_scholar";
export const name = "Google Scholar (qua medical-sidecar; scrape, dễ dính CAPTCHA)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["general", "grey_literature", "theses", "multilingual"];

/**
 * Scholar byline: "A Nguyen, B Tran - Journal of Hydrology, 2021 - elsevier.com"
 * Split on " - "; the middle chunk holds venue + year, the last is the host.
 */
function parseByline(byline) {
  const out = { authors: [], venue: null, year: null };
  if (!byline) return out;
  const parts = String(byline).split(/\s+-\s+/);

  if (parts[0]) {
    out.authors = parts[0]
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 1 && a.length < 80 && !/^\d+$/.test(a));
  }
  if (parts.length > 1) {
    const mid = parts[1];
    const ym = mid.match(/\b(19\d{2}|20\d{2})\b/);
    if (ym) out.year = parseInt(ym[1], 10);
    const venue = mid.replace(/,?\s*\b(19\d{2}|20\d{2})\b\s*$/, "").trim();
    if (venue && venue.length > 1) out.venue = venue;
  }
  return out;
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const base = (config.medicalSidecarUrl || process.env.MEDICAL_SIDECAR_URL || "http://127.0.0.1:8770").replace(/\/$/, "");

  try {
    const resp = await fetch(`${base}/google-scholar?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      signal: withTimeout(signal, 25000),
    });
    // 500 here usually means CAPTCHA — return nothing rather than half-data.
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const r of data?.results || []) {
      if (papers.length >= limit) break;
      const title = stripHtml(r.title || "");
      if (!title) continue;

      const { authors, venue, year } = parseByline(r.authors);
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const url = r.url || null;
      const isPdf = url ? /\.pdf($|\?)/i.test(url) : false;

      papers.push({
        id: `google_scholar:${url || title.slice(0, 60)}`,
        title,
        authors,
        year,
        doi: null,
        arxiv_id: null,
        // `snippet` is a search-result fragment with ellipses, not an abstract.
        abstract: null,
        citation_count: null,
        pdf_url: isPdf ? url : null,
        url,
        source: "google_scholar",
        venue: venue || "Google Scholar",
        volume: null,
        issue: null,
        pages: null,
        publisher: null,
        type: "article",
        issn: null,
        is_oa: isPdf,
        snippet: r.snippet ? stripHtml(r.snippet) : null,
      });
    }

    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[google_scholar] search error:", err.message);
    }
    // This source is a sidecar, not a public API. When the sidecar is
    // unreachable the honest answer is "service down", not "no results" —
    // the latter reads as an empty literature and hides the outage.
    const offline = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|Connect Timeout/i.test(err.message || "");
    if (offline) {
      return {
        papers: [],
        total: 0,
        unavailable: true,
        reason: `sidecar unreachable (MEDICAL_SIDECAR_URL) — ${err.message.slice(0, 60)}`,
      };
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchGoogleScholar };
