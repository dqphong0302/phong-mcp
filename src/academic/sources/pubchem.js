/**
 * NIH PubChem Chemical Compound source plugin.
 * Free, no API key required.
 * Docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 *
 * Provides: Chemical structures, IUPAC nomenclature, molecular weight,
 * pharmacological actions, and biological activity.
 */

import { fromPubChem } from "../formatter.js";

export const id = "pubchem";
export const name = "NIH PubChem (Chemical & Bioactivity)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["chemistry", "pharmacology", "biochemistry", "drug_discovery", "bio"];

const EUTILS_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const PUG_REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

/**
 * Search PubChem compounds.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const count = Math.min(limit, 10);

  // 1. Direct name lookup via PUG REST first
  try {
    const pugUrl = `${PUG_REST}/compound/name/${encodeURIComponent(query.trim())}/property/IUPACName,MolecularFormula,MolecularWeight,InChIKey,Title/JSON`;
    const resp = await fetch(pugUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const props = data.PropertyTable?.Properties || [];
      if (props.length > 0) {
        const papers = props.map((p) => fromPubChem({
          cid: p.CID,
          name: p.Title || query,
          iupac_name: p.IUPACName,
          molecular_formula: p.MolecularFormula,
          molecular_weight: p.MolecularWeight,
          inchikey: p.InChIKey,
        }));
        return { papers: papers.slice(0, limit), total: papers.length };
      }
    }
  } catch (err) {
    // fallback to E-utilities text search
  }

  // 2. Fallback: E-utilities PCCompound search
  try {
    const searchUrl = `${EUTILS_URL}/esearch.fcgi?db=pccompound&term=${encodeURIComponent(query)}&retmax=${count}&retmode=json`;
    const resp = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const searchData = await resp.json();
    const idList = searchData.esearchresult?.idlist || [];
    if (idList.length === 0) return { papers: [], total: 0 };

    const sumUrl = `${EUTILS_URL}/esummary.fcgi?db=pccompound&id=${idList.join(",")}&retmode=json`;
    const sumResp = await fetch(sumUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!sumResp.ok) return { papers: [], total: 0 };
    const sumData = await sumResp.json();
    const result = sumData.result || {};

    const papers = idList.map((cid) => {
      const item = result[cid] || {};
      return fromPubChem({
        cid,
        name: item.title || item.synonymlist?.[0] || query,
        iupac_name: item.iupacname,
        molecular_formula: item.molecularformula,
        molecular_weight: item.molecularweight,
        description: item.meshheadinglist?.join("; "),
      });
    });

    return {
      papers: papers.slice(0, limit),
      total: searchData.esearchresult?.count ? parseInt(searchData.esearchresult.count, 10) : papers.length,
    };
  } catch (err) {
    console.warn("[pubchem] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(cid, _config = {}) {
  const cleanCid = cid.replace(/^pubchem:/i, "").trim();
  if (!cleanCid) return null;

  try {
    const url = `${PUG_REST}/compound/cid/${encodeURIComponent(cleanCid)}/property/IUPACName,MolecularFormula,MolecularWeight,InChIKey,Title/JSON`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.PropertyTable?.Properties?.[0];
    if (!p) return null;
    return fromPubChem({
      cid: p.CID,
      name: p.Title,
      iupac_name: p.IUPACName,
      molecular_formula: p.MolecularFormula,
      molecular_weight: p.MolecularWeight,
      inchikey: p.InChIKey,
    });
  } catch {
    return null;
  }
}

export { search as searchPubChem };
