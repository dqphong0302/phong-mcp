/**
 * RCSB Protein Data Bank (PDB) Search API source plugin.
 * Free, no API key required.
 * Docs: https://search.rcsb.org/
 *
 * Provides: 3D macromolecular structures (Proteins, Nucleic Acids, Cryo-EM/X-ray).
 */

import { fromPdb } from "../formatter.js";

export const id = "rcsb_pdb";
export const name = "RCSB Protein Data Bank (3D Structures)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["structural_biology", "proteins", "biophysics", "bioinformatics"];

const SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query";
const DATA_URL = "https://data.rcsb.org/rest/v1/core/entry";

/**
 * Search RCSB PDB structures.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const count = Math.min(limit, 10);

  const cleanQuery = query.trim();

  // If direct PDB ID (4 chars, e.g. 1TIM, 6VXX, 7KRR)
  if (/^[0-9][a-zA-Z0-9]{3}$/i.test(cleanQuery)) {
    const entry = await getById(cleanQuery);
    return entry ? { papers: [entry], total: 1 } : { papers: [], total: 0 };
  }

  const payload = {
    query: {
      type: "terminal",
      service: "full_text",
      parameters: {
        value: cleanQuery,
      },
    },
    return_type: "entry",
    request_options: {
      paginate: {
        start: 0,
        rows: count,
      },
    },
  };

  try {
    const resp = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const resultList = data.result_set || [];
    if (resultList.length === 0) return { papers: [], total: 0 };

    const tasks = resultList.map(async (r) => {
      const id = r.identifier;
      try {
        const dResp = await fetch(`${DATA_URL}/${encodeURIComponent(id)}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!dResp.ok) return null;
        const entry = await dResp.json();
        return fromPdb(entry);
      } catch {
        return null;
      }
    });

    const entries = (await Promise.all(tasks)).filter(Boolean);

    return {
      papers: entries.slice(0, limit),
      total: data.total_count || entries.length,
    };
  } catch (err) {
    console.warn("[rcsb_pdb] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(pdbId, _config = {}) {
  const cleanId = pdbId.replace(/^pdb:/i, "").trim().toUpperCase();
  if (!cleanId) return null;

  try {
    const resp = await fetch(`${DATA_URL}/${encodeURIComponent(cleanId)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const entry = await resp.json();
    return entry ? fromPdb(entry) : null;
  } catch {
    return null;
  }
}

export { search as searchRcsbPdb };
