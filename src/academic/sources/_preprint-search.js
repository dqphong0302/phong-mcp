/**
 * Keyword search over bioRxiv / medRxiv preprints.
 *
 * api.biorxiv.org has no search endpoint. It serves a date window, 30 records
 * per cursor call, oldest first — so "searching" it means downloading a slice
 * of a 74,000-record corpus and grepping locally. A query for GLP-1 and
 * cardiovascular outcomes scanned 90 records and matched nothing, while the
 * preprints plainly exist.
 *
 * Europe PMC indexes both servers and supports real field queries, so keyword
 * search goes there. The date-window API keeps the jobs it is actually good at:
 * recency browsing and DOI lookup.
 */

import { fromEuropePMC } from "../formatter.js";
import { filterByRelevance } from "./_relevance.js";

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const TIMEOUT_MS = 20000;

/**
 * Search one preprint server by keyword.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {"medRxiv"|"bioRxiv"} opts.publisher
 * @param {number} [opts.limit=10]
 * @param {number} [opts.year_min]
 * @param {number} [opts.year_max]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{papers: Object[], total: number}>}
 */
export async function searchPreprints(query, opts = {}) {
  const { publisher, limit = 10, year_min, year_max, signal } = opts;

  // SRC:PPR restricts to preprints; PUBLISHER pins the specific server, so a
  // medRxiv search cannot quietly return Research Square records.
  const clauses = [`(${query})`, "(SRC:PPR)"];
  if (publisher) clauses.push(`(PUBLISHER:"${publisher}")`);
  if (year_min || year_max) {
    clauses.push(`(FIRST_PDATE:[${year_min || 1900}-01-01 TO ${year_max || 2100}-12-31])`);
  }

  const params = new URLSearchParams({
    query: clauses.join(" AND "),
    format: "json",
    pageSize: String(Math.min(limit, 100)),
    resultType: "core",
  });

  const resp = await fetch(`${BASE}?${params}`, {
    headers: { Accept: "application/json" },
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Europe PMC HTTP ${resp.status}`);

  const data = await resp.json();
  const results = data?.resultList?.result || [];
  const source = publisher ? publisher.toLowerCase() : "preprint";

  const papers = results.map((r) => {
    const paper = fromEuropePMC(r);
    // Attribute the record to the preprint server, not to the index that
    // surfaced it — the caller asked for medRxiv, and citations must say so.
    return {
      ...paper,
      source,
      venue: paper.venue || publisher || "Preprint",
      type: "preprint",
    };
  });

  // The index ranks loosely at the tail — a clinical query against bioRxiv, a
  // biology server, returns whatever it has. Hold these to the same relevance
  // bar as every other source rather than passing the ranking through.
  const relevant = filterByRelevance(papers, query, {
    getTitle: (p) => p.title || "",
    getText: (p) => `${p.title || ""} ${p.abstract || ""}`,
    minCoverage: 0.5,
  });

  return { papers: relevant, total: data?.hitCount ?? relevant.length };
}

export default { searchPreprints };
