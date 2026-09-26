/**
 * Reactome Pathway Database ContentService REST API.
 * Direct authentic API, keyless, zero proxy.
 * Docs: https://reactome.org/ContentService/
 *
 * Provides: Curated human biological pathways, reactions, disease mechanisms,
 * and molecular complexes.
 */

import { fromReactome } from "../formatter.js";
import { withTimeout } from "./_ojs.js";

export const id = "reactome";
export const name = "Reactome (Biological Pathways & Molecular Mechanisms)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["bio", "medicine", "genomics", "pathways", "molecular_biology"];

const API_BASE = "https://reactome.org/ContentService/search/query";

/**
 * Search Reactome biological pathways.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  const cleanQuery = query.trim();
  if (!cleanQuery) return { papers: [], total: 0 };

  const url = `${API_BASE}?query=${encodeURIComponent(cleanQuery)}&species=Homo+sapiens&types=Pathway&cluster=true`;

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
    const results = data.results || [];
    
    // Flatten entries across clusters if clustered
    let entries = [];
    if (Array.isArray(results)) {
      for (const cluster of results) {
        if (cluster.entries && Array.isArray(cluster.entries)) {
          entries.push(...cluster.entries);
        } else if (cluster.stId) {
          entries.push(cluster);
        }
      }
    }

    const papers = entries.slice(0, limit).map(fromReactome);
    return { papers, total: entries.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[reactome] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

export async function getById(stId, _config = {}) {
  const cleanId = String(stId).replace(/^reactome:/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = `https://reactome.org/ContentService/data/query/enhanced/${cleanId}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const item = await resp.json();
    return item ? fromReactome(item) : null;
  } catch {
    return null;
  }
}

export { search as searchReactome };
