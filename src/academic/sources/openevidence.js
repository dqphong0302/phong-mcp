/**
 * OpenEvidence, via this stack's medical-sidecar (POST /openevidence).
 *
 * READ THIS BEFORE ENABLING. Unlike every other source here, the sidecar
 * endpoint is a raw proxy to https://www.openevidence.com/api/chat — a
 * conversational endpoint that answers a clinical question and attaches
 * citations. It is NOT a structured paper-search API:
 *   - it needs YOUR OpenEvidence session (Authorization / Cookie /
 *     x-openevidence-key), which the sidecar forwards but does not own;
 *   - the citation payload shape is not contractual and can change.
 *
 * So this plugin is gated behind OPENEVIDENCE_ENABLED=1 and parses only
 * citation entries it can positively identify. If the response carries no
 * recognisable citations it returns nothing — it never turns prose into
 * fake paper records. Treat what it does return as leads to verify, not as
 * an indexed corpus.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "openevidence";
export const name = "OpenEvidence (clinical Q&A — trả về nguồn trích dẫn, cần phiên đăng nhập)";
export const requiresKey = true;
export const keyEnvVar = "OPENEVIDENCE_ENABLED";
export const domains = ["medicine", "clinical", "evidence_based"];

/** Pull citation-ish arrays out of whatever the chat endpoint returned. */
function collectCitations(data) {
  const buckets = [
    data?.citations, data?.references, data?.sources,
    data?.data?.citations, data?.result?.citations,
    data?.message?.citations,
  ];
  for (const b of buckets) if (Array.isArray(b) && b.length) return b;
  return [];
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  if (!(config.openevidenceEnabled || process.env.OPENEVIDENCE_ENABLED)) {
    return { papers: [], total: 0 };
  }
  const base = (config.medicalSidecarUrl || process.env.MEDICAL_SIDECAR_URL || "http://localhost:8770").replace(/\/$/, "");

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.OPENEVIDENCE_AUTHORIZATION) headers.Authorization = process.env.OPENEVIDENCE_AUTHORIZATION;
  if (process.env.OPENEVIDENCE_COOKIE) headers.Cookie = process.env.OPENEVIDENCE_COOKIE;
  if (process.env.OPENEVIDENCE_KEY) headers["x-openevidence-key"] = process.env.OPENEVIDENCE_KEY;

  try {
    const resp = await fetch(`${base}/openevidence`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, question: query, messages: [{ role: "user", content: query }] }),
      signal: withTimeout(signal, 30000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const c of collectCitations(data)) {
      if (papers.length >= limit) break;
      const title = stripHtml(c.title || c.name || "");
      if (!title) continue;   // no title → not a citation we can trust

      const doi = String(c.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim() || null;
      const yr = parseInt(String(c.year ?? c.publication_year ?? c.date ?? "").slice(0, 4), 10);
      const year = Number.isFinite(yr) ? yr : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }

      papers.push({
        id: doi ? `doi:${doi}` : `openevidence:${c.pmid || c.id || title.slice(0, 60)}`,
        title,
        authors: Array.isArray(c.authors) ? c.authors.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean) : [],
        year,
        doi,
        arxiv_id: null,
        abstract: null,
        citation_count: null,
        pdf_url: null,
        url: c.url || (doi ? `https://doi.org/${doi}` : c.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/` : null),
        source: "openevidence",
        venue: c.journal || c.source || "OpenEvidence",
        volume: null,
        issue: null,
        pages: null,
        publisher: null,
        type: "article",
        issn: null,
        is_oa: false,
        pmid: c.pmid || null,
      });
    }

    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[openevidence] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchOpenEvidence };
