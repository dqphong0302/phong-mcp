/**
 * UniProt Knowledgebase REST API source plugin.
 * Free, no API key required.
 * Docs: https://www.uniprot.org/help/api
 *
 * Provides: Protein sequence records, functions, subcellular locations, and AlphaFold links.
 */

import { fromUniProt } from "../formatter.js";

export const id = "uniprot";
export const name = "UniProt (Protein Knowledgebase)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["bioinformatics", "genetics", "proteins", "molecular_biology", "medicine"];

const BASE_URL = "https://rest.uniprot.org/uniprotkb";

/**
 * Search UniProt protein entries.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const size = Math.min(limit, 20);

  const params = new URLSearchParams({
    query: query.trim(),
    format: "json",
    size: String(size),
  });

  try {
    const resp = await fetch(`${BASE_URL}/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const results = data.results || [];
    const papers = results.map(fromUniProt);

    return {
      papers: papers.slice(0, limit),
      total: papers.length,
    };
  } catch (err) {
    console.warn("[uniprot] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(accession, _config = {}) {
  const cleanAcc = accession.replace(/^uniprot:/i, "").trim();
  if (!cleanAcc) return null;

  try {
    const resp = await fetch(`${BASE_URL}/${encodeURIComponent(cleanAcc)}.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const entry = await resp.json();
    return entry ? fromUniProt(entry) : null;
  } catch {
    return null;
  }
}

export { search as searchUniProt };
