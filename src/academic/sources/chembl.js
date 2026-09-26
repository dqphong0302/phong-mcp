/**
 * EMBL-EBI ChEMBL Bioactive Molecules & Drug Discovery REST API.
 * Direct authentic API, keyless, zero proxy.
 * Docs: https://www.ebi.ac.uk/chembl/ws
 *
 * Provides: Bioactive molecules, drug targets, mechanisms of action,
 * maximum clinical trial phases, SMILES, and chemical properties.
 */

import { fromChembl } from "../formatter.js";
import { withTimeout } from "./_ojs.js";

export const id = "chembl";
export const name = "ChEMBL / EMBL-EBI (Bioactive Compounds & Drug Discovery)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["chemistry", "pharmacology", "medicine", "drug_discovery", "bioinformatics"];

const API_BASE = "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json";

/**
 * Search ChEMBL database for bioactive molecules and drugs.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  const cleanQuery = query.trim();
  if (!cleanQuery) return { papers: [], total: 0 };

  const url = `${API_BASE}?q=${encodeURIComponent(cleanQuery)}&limit=${Math.min(limit, 25)}`;

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
    const molecules = data.molecules || [];
    const total = data.page_meta?.total_count || molecules.length;

    const papers = molecules.slice(0, limit).map(fromChembl);
    return { papers, total };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[chembl] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(chemblId, _config = {}) {
  const cleanId = String(chemblId).replace(/^chembl:/i, "").trim().toUpperCase();
  if (!cleanId) return null;

  try {
    const url = `https://www.ebi.ac.uk/chembl/api/data/molecule/${cleanId}.json`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const item = await resp.json();
    return item ? fromChembl(item) : null;
  } catch {
    return null;
  }
}

export { search as searchChembl };
