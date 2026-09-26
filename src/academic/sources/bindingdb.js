/**
 * BindingDB REST API — Database of measured binding affinities for drug targets.
 * Direct authentic API, keyless, zero proxy.
 * Docs: https://www.bindingdb.org/bind/index.jsp
 *
 * Provides: Protein-ligand binding affinities (Ki, IC50, Kd, EC50), drug candidate
 * interactions, enzyme inhibition constants.
 */

import { fromBindingDb } from "../formatter.js";
import { withTimeout } from "./_ojs.js";

export const id = "bindingdb";
export const name = "BindingDB (Drug-Target Binding Affinities: Ki, IC50, Kd)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["chemistry", "pharmacology", "medicine", "drug_discovery", "bioinformatics"];

const API_BASE = "https://www.bindingdb.org/axis2/services/BDBService/getLigandsByUniprot";

/**
 * Search BindingDB for drug-target binding assays.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  const cleanQuery = query.trim();
  if (!cleanQuery) return { papers: [], total: 0 };

  // Support querying by UniProt ID or protein keyword
  const url = `https://www.bindingdb.org/rweb/rest/search?target=${encodeURIComponent(cleanQuery)}&limit=${Math.min(limit, 25)}`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain",
        "User-Agent": "academic-search-mcp/2.0 (mailto:phongdang@home-server.local)",
      },
      signal: withTimeout(signal, 15000),
    });

    if (!resp.ok) {
      // Fallback search via BindingDB JSON/XML search service
      const fallbackUrl = `https://www.bindingdb.org/axis2/services/BDBService/getLigandsByUniprot?uniprot=${encodeURIComponent(cleanQuery)}`;
      const fallbackResp = await fetch(fallbackUrl, {
        headers: { Accept: "application/xml, text/xml", "User-Agent": "academic-search-mcp/2.0" },
        signal: withTimeout(signal, 10000),
      });
      if (!fallbackResp.ok) return { papers: [], total: 0 };
      const xml = await fallbackResp.text();
      const papers = parseBindingDbXml(xml, cleanQuery).slice(0, limit);
      return { papers, total: papers.length };
    }

    const data = await resp.json();
    const items = Array.isArray(data) ? data : (data.results || []);
    const papers = items.slice(0, limit).map((it) => fromBindingDb(it, cleanQuery));
    return { papers, total: papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn("[bindingdb] search error:", err.message);
    }
    return { papers: [], total: 0 };
  }
}

function parseBindingDbXml(xml, target) {
  const list = [];
  const re = /<affinities>([\s\S]*?)<\/affinities>/g;
  let m;
  let count = 0;
  while ((m = re.exec(xml)) !== null && count < 20) {
    const block = m[1];
    const smi = /<smile>(.*?)<\/smile>/.exec(block)?.[1] || "";
    const affinity = /<affinity>(.*?)<\/affinity>/.exec(block)?.[1] || "";
    const pmid = /<pmid>(.*?)<\/pmid>/.exec(block)?.[1] || "";
    const bdbid = /<monomerid>(.*?)<\/monomerid>/.exec(block)?.[1] || `chem_${count}`;
    count++;
    list.push(fromBindingDb({
      monomerid: bdbid,
      smile: smi,
      affinity,
      pmid,
      target,
    }, target));
  }
  return list;
}

export { search as searchBindingDb };
