/**
 * ClinicalTrials.gov REST API v2 source plugin.
 * Free, no API key required.
 * Docs: https://clinicaltrials.gov/data-api/about-api
 *
 * Provides: Clinical trials, randomized controlled trials (RCTs), study phases,
 * conditions, interventions, and recruitment statuses.
 */

import { fromClinicalTrials } from "../formatter.js";

export const id = "clinicaltrials";
export const name = "ClinicalTrials.gov";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "clinical_trials", "rct", "pharmacology", "health"];

const BASE_URL = "https://clinicaltrials.gov/api/v2/studies";

/**
 * Search ClinicalTrials.gov studies.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, sort = "relevance" } = opts;
  const pageSize = Math.min(limit, 30);

  const params = new URLSearchParams({
    "query.term": query,
    pageSize: String(pageSize),
    format: "json",
  });

  if (sort === "recency") {
    params.set("sort", "LastUpdatePostDate:desc");
  }

  const url = `${BASE_URL}?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return { papers: [], total: 0 };
    }

    const data = await resp.json();
    const studies = data.studies || [];
    const papers = studies.map(fromClinicalTrials);

    return {
      papers: papers.slice(0, limit),
      total: data.totalCount || papers.length,
    };
  } catch (err) {
    console.warn("[clinicaltrials] search failed:", err.message);
    return { papers: [], total: 0 };
  }
}

/**
 * Get study by NCT ID (e.g. NCT05118438).
 *
 * @param {string} nctId
 * @param {Object} [_config]
 */
export async function getById(nctId, _config = {}) {
  const cleanId = nctId.replace(/^nct:/i, "").trim().toUpperCase();
  if (!cleanId.startsWith("NCT")) return null;

  try {
    const url = `${BASE_URL}/${encodeURIComponent(cleanId)}`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) return null;
    const study = await resp.json();
    return study ? fromClinicalTrials(study) : null;
  } catch {
    return null;
  }
}

export { search as searchClinicalTrials };
