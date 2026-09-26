/**
 * NCBI ClinVar Genetic Variations source plugin.
 * Free, no API key required.
 * Docs: https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/
 *
 * Provides: Human genetic variants, clinical significance, and associated medical conditions.
 */

import { fromClinVar } from "../formatter.js";

export const id = "clinvar";
export const name = "NCBI ClinVar (Genetics & Clinical Variants)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["genetics", "genomics", "clinical_genetics", "rare_diseases", "medicine"];

const EUTILS_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Search NCBI ClinVar database.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const count = Math.min(limit, 15);

  try {
    const searchUrl = `${EUTILS_URL}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(query.trim())}&retmax=${count}&retmode=json`;
    const resp = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const idList = data.esearchresult?.idlist || [];
    if (idList.length === 0) return { papers: [], total: 0 };

    const sumUrl = `${EUTILS_URL}/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json`;
    const sumResp = await fetch(sumUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!sumResp.ok) return { papers: [], total: 0 };
    const sumData = await sumResp.json();
    const result = sumData.result || {};

    const papers = idList.map((uid) => {
      const item = result[uid] || {};
      return fromClinVar({
        id: uid,
        title: item.title || `ClinVar Variant ${uid}`,
        clinical_significance: item.clinical_significance?.description || item.germline_classification?.description,
        genes: item.genes || [],
        trait_names: (item.trait_set || []).map((t) => t.trait_name).filter(Boolean),
        variation_set: item.variation_set,
      });
    });

    return {
      papers: papers.slice(0, limit),
      total: data.esearchresult?.count ? parseInt(data.esearchresult.count, 10) : papers.length,
    };
  } catch (err) {
    console.warn("[clinvar] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(uid, _config = {}) {
  const cleanUid = uid.replace(/^clinvar:/i, "").trim();
  if (!cleanUid) return null;

  try {
    const url = `${EUTILS_URL}/esummary.fcgi?db=clinvar&id=${encodeURIComponent(cleanUid)}&retmode=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const item = data.result?.[cleanUid];
    return item ? fromClinVar({ id: cleanUid, ...item }) : null;
  } catch {
    return null;
  }
}

export { search as searchClinVar };
