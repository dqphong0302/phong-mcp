/**
 * ZINC Molecular Database REST API — Commercially-available compounds for virtual screening.
 * Direct authentic API, keyless, zero proxy.
 * Docs: https://zinc15.docking.org/
 *
 * Provides: 3D chemical structures, SMILES, molecular weight, LogP, purchasability,
 * and docking ligands.
 */

import { fromZinc } from "../formatter.js";
import { withTimeout } from "./_ojs.js";

export const id = "zinc";
export const name = "ZINC (Small Molecules & Virtual Screening Compounds)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["chemistry", "pharmacology", "drug_discovery", "computational_chemistry"];

const API_BASE = "https://zinc15.docking.org/substances.json";

/**
 * Search ZINC database for chemical compounds.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  const cleanQuery = query.trim();
  if (!cleanQuery) return { papers: [], total: 0 };

  const url = `${API_BASE}?term=${encodeURIComponent(cleanQuery)}&count=${Math.min(limit, 25)}`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (mailto:phongdang@home-server.local)",
      },
      signal: withTimeout(signal, 15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const items = await resp.json();
    if (!Array.isArray(items)) return { papers: [], total: 0 };

    const papers = items.slice(0, limit).map(fromZinc);
    return { papers, total: items.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[zinc] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(zincId, _config = {}) {
  const cleanId = String(zincId).replace(/^zinc:/i, "").replace(/^ZINC/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = `https://zinc15.docking.org/substances/ZINC${cleanId}.json`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const item = await resp.json();
    return item ? fromZinc(item) : null;
  } catch {
    return null;
  }
}

export { search as searchZinc };
