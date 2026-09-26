/**
 * ISRCTN registry — international clinical trial registry (UK-based, global
 * scope), free API, no key.
 *
 * Why this and not WHO ICTRP: the ICTRP Search Portal Web Service is a
 * fee-based XML service quoted on request, so it cannot be wired in for free.
 * ISRCTN is the largest freely queryable non-US registry and, together with
 * clinicaltrials.gov, gives a systematic review the two-registry coverage that
 * PRISMA search strategies normally require.
 *
 * Returns WHO-format XML.
 * Registry: https://www.isrctn.com/
 */

import { filterByRelevance } from "./_relevance.js";
import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "isrctn";
export const name = "ISRCTN (registry thử nghiệm lâm sàng quốc tế, ngoài Mỹ)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["clinical", "medicine", "clinical_trials", "evidence_based"];

const API = "https://www.isrctn.com/api/query/format/who";

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? stripHtml(m[1]) : null;
};

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  let q = query;
  if (year_min || year_max) {
    q += ` AND lastEdited GT ${year_min || 1990}-01-01 AND lastEdited LT ${(year_max || 3000)}-12-31`;
  }
  const params = new URLSearchParams({ q, limit: String(Math.min(limit, 100)) });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/xml,text/xml", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 25000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const xml = await resp.text();

    const blocks = xml.split(/<trial[\s>]/i).slice(1);
    const papers = [];

    for (const b of blocks) {
      if (papers.length >= limit) break;

      const isrctn = tag(b, "trial_id") || tag(b, "main_id") || tag(b, "isrctn");
      const title = tag(b, "public_title") || tag(b, "scientific_title") || tag(b, "title");
      if (!title) continue;

      const dateRaw = tag(b, "date_registration") || tag(b, "registration_date") || tag(b, "date_enrolment");
      const yr = dateRaw ? parseInt(String(dateRaw).match(/\b(19|20)\d{2}\b/)?.[0] ?? "", 10) : NaN;
      const year = Number.isFinite(yr) ? yr : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      const sponsor = tag(b, "primary_sponsor");
      const phase = tag(b, "phase");
      const condition = tag(b, "condition");
      const url = tag(b, "web_address")
        || (isrctn ? `https://www.isrctn.com/${String(isrctn).replace(/\s+/g, "")}` : null);

      papers.push({
        id: `isrctn:${isrctn || title.slice(0, 50)}`,
        title,
        // Registries list a contact, not an author list. Leave empty rather
        // than passing off a sponsor as an author.
        authors: [],
        year,
        doi: tag(b, "doi") || null,
        arxiv_id: null,
        abstract: tag(b, "study_hypothesis") || tag(b, "brief_summary") || null,
        citation_count: null,
        pdf_url: null,
        url,
        source: "isrctn",
        venue: [condition, phase].filter(Boolean).join(" — ") || "ISRCTN registry",
        volume: null,
        issue: null,
        pages: null,
        publisher: sponsor || "ISRCTN Registry",
        type: "clinical_trial",
        issn: null,
        is_oa: true,
        registry_id: isrctn || null,
        recruitment_status: tag(b, "recruitment_status") || null,
      });
    }

    // The registry API matches loosely and happily returns trials sharing only
    // a common word with the query — a GLP-1 search came back with magnesium
    // deficiency and olive-oil trials. Enforce relevance here.
    const relevant = filterByRelevance(papers, query, {
      getTitle: (p) => p.title || "",
      getText: (p) => `${p.title || ""} ${p.abstract || ""} ${p.venue || ""}`,
      minCoverage: 0.5,
    });

    return { papers: relevant, total: relevant.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[isrctn] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchIsrctn };
