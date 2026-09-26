/**
 * Consensus.app — evidence-focused paper search, reached through this stack's
 * own consensus-sidecar (FastAPI, port 8767 by default).
 *
 * Why it belongs in the registry rather than staying a standalone tool: it
 * returns structured papers with DOI, year, citation count AND a `study_type`
 * badge (RCT / meta-analysis / cohort / case report). That badge is exactly
 * what the PRISMA and risk-of-bias tools need, and it can only be used for
 * ranking and screening if the paper flows through the normal search pipeline.
 *
 * Uses `deep_search` when a large limit is requested (multi-page + dedupe),
 * plain `search` otherwise.
 */

import { withTimeout, stripHtml } from "./_ojs.js";

export const id = "consensus";
export const name = "Consensus.app (evidence search, study-type badges)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["biomedical", "medicine", "evidence_based", "clinical", "social_science"];

/** Consensus study_type → the paper `type` used across this registry. */
const TYPE_MAP = {
  "meta-analysis": "meta_analysis",
  "systematic review": "systematic_review",
  "rct": "rct",
  "randomized controlled trial": "rct",
  "case report": "case_report",
  "cohort": "article",
  "literature review": "review",
};

function toPaper(p) {
  const year = Number.parseInt(String(p.year ?? ""), 10);
  const doi = (p.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim() || null;
  const studyType = String(p.study_type || "").toLowerCase().trim();

  return {
    id: doi ? `doi:${doi}` : `consensus:${p.url || p.title}`,
    title: stripHtml(p.title || ""),
    authors: Array.isArray(p.authors) ? p.authors.filter(Boolean) : [],
    year: Number.isFinite(year) ? year : null,
    doi,
    arxiv_id: null,
    abstract: p.abstract ? stripHtml(p.abstract) : null,
    citation_count: Number.isFinite(p.citation_count) ? p.citation_count : null,
    pdf_url: null,
    url: p.url || (doi ? `https://doi.org/${doi}` : null),
    source: "consensus",
    venue: p.journal || "Consensus.app",
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    type: TYPE_MAP[studyType] || "article",
    issn: null,
    is_oa: false,
    // Extra signals the rest of the pipeline can use for screening.
    study_type: studyType || null,
    claim: p.claim ? stripHtml(p.claim) : null,
  };
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  // config.js exports the sidecar block separately from `academic`, so read
  // both shapes plus the env fallback.
  const base = (config.consensusSidecarUrl || process.env.CONSENSUS_SIDECAR_URL || "http://127.0.0.1:8767").replace(/\/$/, "");
  const key = config.consensusSidecarKey || process.env.CONSENSUS_SIDECAR_KEY || "";

  const deep = limit > 20;
  const endpoint = deep ? "/v1/consensus/deep_search" : "/v1/consensus/search";
  const body = deep
    ? { query, pages: 3, page_size: 20, max_papers: Math.min(limit, 100), include_abstracts: true, year_min, year_max }
    : { query, limit: Math.min(limit, 20), page: 1, year_min, year_max };

  try {
    const resp = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 30000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const raw of data?.results || []) {
      if (papers.length >= limit) break;
      const p = toPaper(raw);
      if (!p.title) continue;
      if (p.year != null) {
        if (year_min && p.year < year_min) continue;
        if (year_max && p.year > year_max) continue;
      }
      papers.push(p);
    }

    return { papers, total: data?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[consensus] search error:", err.message);
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
        reason: `sidecar unreachable (CONSENSUS_SIDECAR_URL) — ${err.message.slice(0, 60)}`,
      };
    }
    return { papers: [], total: 0 };
  }
}

export { search as searchConsensus };
