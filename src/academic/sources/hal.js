/**
 * HAL (Hyper Articles en Ligne) source plugin.
 * Free, no API key required.
 * Docs: https://api.archives-ouvertes.fr/docs/search
 *
 * Coverage: 1M+ documents, strong for Humanities, Social Sciences, EU research.
 * HAL is the largest French OA repository, widely used across European institutions.
 */

import { fromHal } from "../formatter.js";

export const id = "hal";
export const name = "HAL (Archives Ouvertes)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["humanities", "social_sciences", "eu_research", "general"];

const BASE = "https://api.archives-ouvertes.fr/search";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  let q = query;
  const filters = [];
  if (year_min) filters.push(`producedDateY_i:[${year_min} TO ${year_max || "*"}]`);

  const params = new URLSearchParams({
    q,
    fq: filters.join(" AND ") || undefined,
    rows: String(Math.min(limit, 50)),
    wt: "json",
    fl: "docid,title_s,authFullName_s,producedDateY_i,abstract_s,doiId_s,uri_s,linkExtUrl_s,journalTitle_s,publicationDateY_i,fileMain_s",
    sort: sort === "recency" ? "producedDateY_i desc" : "score desc",
  });

  // Remove undefined params
  if (!filters.length) params.delete("fq");

  const resp = await fetch(`${BASE}/?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) throw new Error(`HAL HTTP ${resp.status}`);
  const data = await resp.json();
  const docs = data.response?.docs || [];

  return {
    papers: docs.map(fromHal),
    total: data.response?.numFound || 0,
  };
}

export async function getById(doi, _config = {}) {
  if (!doi) return null;
  try {
    const params = new URLSearchParams({
      q: `doiId_s:"${doi}"`,
      rows: "1",
      wt: "json",
      fl: "docid,title_s,authFullName_s,producedDateY_i,abstract_s,doiId_s,uri_s,fileMain_s,journalTitle_s",
    });
    const resp = await fetch(`${BASE}/?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const doc = data.response?.docs?.[0];
    return doc ? fromHal(doc) : null;
  } catch {
    return null;
  }
}
