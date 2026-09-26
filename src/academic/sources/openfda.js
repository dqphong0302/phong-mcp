/**
 * openFDA Drug Labeling and Monograph plugin.
 * Free, no API key required.
 * Docs: https://open.fda.gov/apis/drug/label/
 *
 * Provides: FDA drug monographs, indications, warnings, active ingredients,
 * dosages, contraindications, and adverse reaction documentation.
 */

import { fromOpenFda } from "../formatter.js";

export const id = "openfda";
export const name = "openFDA (Drug & Regulatory Info)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "pharmacology", "fda", "drug_safety", "clinical"];

const BASE_URL = "https://api.fda.gov/drug/label.json";

/**
 * Search FDA drug label database.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const pageSize = Math.min(limit, 25);

  // Clean query for openFDA Lucene syntax
  const cleaned = query
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("+");

  if (!cleaned) return { papers: [], total: 0 };

  const searchQuery = `(openfda.brand_name:"${cleaned}"+OR+openfda.generic_name:"${cleaned}"+OR+openfda.substance_name:"${cleaned}"+OR+indications_and_usage:"${cleaned}"+OR+"${cleaned}")`;
  const url = `${BASE_URL}?search=${searchQuery}&limit=${pageSize}`;

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
    const results = data.results || [];
    const papers = results.map(fromOpenFda);

    return {
      papers: papers.slice(0, limit),
      total: data.meta?.results?.total || papers.length,
    };
  } catch (err) {
    console.warn("[openfda] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchOpenFda };
