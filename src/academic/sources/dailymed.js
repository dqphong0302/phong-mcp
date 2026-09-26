/**
 * NIH DailyMed REST API — Official FDA Structured Product Label (SPL) database.
 * Direct authentic API, keyless, zero proxy.
 * Docs: https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm
 *
 * Provides: FDA drug package inserts, clinical pharmacology, approved indications,
 * contraindications, dosage forms, manufacturer labels.
 */

import { fromDailyMed } from "../formatter.js";
import { withTimeout } from "./_ojs.js";

export const id = "dailymed";
export const name = "DailyMed / NLM (FDA Drug Package Inserts & SPLs)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "pharmacology", "clinical", "fda", "drug_safety"];

const API_BASE = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";

/**
 * Search FDA drug labels on DailyMed.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  const pageSize = Math.min(limit, 25);

  const cleanQuery = query.trim();
  if (!cleanQuery) return { papers: [], total: 0 };

  const url = `${API_BASE}?drug_name=${encodeURIComponent(cleanQuery)}&page=1&pagesize=${pageSize}`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (mailto:phongdang@home-server.local)",
      },
      signal: withTimeout(signal, 15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const items = data.data || [];
    const total = data.metadata?.total_records || items.length;

    const papers = items.slice(0, limit).map(fromDailyMed);

    return { papers, total };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[dailymed] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(setId, _config = {}) {
  const cleanId = String(setId).replace(/^dailymed:/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${cleanId}.json`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data ? fromDailyMed(data.data) : null;
  } catch {
    return null;
  }
}

export { search as searchDailyMed };
