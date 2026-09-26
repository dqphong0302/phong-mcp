/**
 * OpenCitations Index client — keyless citation-graph fallback.
 *
 * Used when Semantic Scholar is unavailable (no SEMANTIC_SCHOLAR_API_KEY, rate
 * limited, or the paper is simply not in S2). OpenCitations needs no key and
 * covers Crossref-deposited reference lists.
 *
 * API: https://opencitations.net/index/api/v2
 *   /citations/doi:<doi>   → works citing <doi>   (each row has `citing`)
 *   /references/doi:<doi>  → works cited by <doi> (each row has `cited`)
 *
 * Rows carry only identifiers, so DOIs are enriched to full paper records in
 * batches via OpenAlex. A paper whose metadata cannot be resolved is still
 * returned with its DOI — never dropped, never invented.
 */

import { fromOpenAlex } from "./formatter.js";

const OC_BASE = "https://opencitations.net/index/api/v2";
const OA_BASE = "https://api.openalex.org/works";
const OC_TIMEOUT_MS = 20000;
const OA_TIMEOUT_MS = 20000;
const OA_BATCH = 50;

function normaliseDoi(doi) {
  return String(doi || "")
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
}

/** Pull the `doi:...` token out of an OpenCitations identifier bundle. */
function extractDoi(idBundle) {
  const m = String(idBundle || "").match(/doi:(\S+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Resolve DOIs to full paper records via OpenAlex, in batches. */
async function enrichDois(dois) {
  const mail = process.env.UNPAYWALL_EMAIL || "";
  const out = new Map();

  for (let i = 0; i < dois.length; i += OA_BATCH) {
    const batch = dois.slice(i, i + OA_BATCH);
    // OpenAlex does not percent-decode filter values: the "|" OR-separator and
    // the "/" inside each DOI must be sent literally, so the query string is
    // assembled by hand rather than with URLSearchParams.
    const query =
      `filter=doi:${batch.join("|")}` +
      `&per-page=${batch.length}` +
      (mail ? `&mailto=${encodeURIComponent(mail)}` : "");

    // One retry: a transient connect timeout must not silently downgrade a
    // whole batch to "(metadata unavailable)" stubs.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${OA_BASE}?${query}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(OA_TIMEOUT_MS),
        });
        if (!res.ok) break;
        const data = await res.json();
        for (const work of data.results || []) {
          const doi = normaliseDoi(work.doi);
          if (doi) out.set(doi, fromOpenAlex(work));
        }
        break;
      } catch {
        // Partial enrichment is acceptable — unresolved DOIs fall back to a stub.
      }
    }
  }

  return out;
}

/** Minimal record for a DOI OpenAlex could not resolve. Nothing is fabricated. */
function stubPaper(doi) {
  return {
    id: `doi:${doi}`,
    title: "(metadata unavailable)",
    authors: [],
    year: null,
    doi,
    arxiv_id: null,
    abstract: null,
    citation_count: null,
    pdf_url: null,
    url: `https://doi.org/${doi}`,
    source: "opencitations",
    venue: null,
    tldr: null,
    type: "article",
    is_oa: false,
  };
}

/**
 * Fetch the citation graph for a DOI from OpenCitations.
 *
 * @param {string} doi
 * @param {"citations"|"references"} mode
 * @param {number} limit
 * @returns {Promise<import("./formatter.js").AcademicPaper[]>}
 */
export async function getCitationGraph(doi, mode = "citations", limit = 10) {
  const clean = normaliseDoi(doi);
  if (!/^10\.\d{4,}\//.test(clean)) return [];

  const endpoint = mode === "references" ? "references" : "citations";
  const field = mode === "references" ? "cited" : "citing";

  let rows;
  try {
    const res = await fetch(`${OC_BASE}/${endpoint}/doi:${encodeURIComponent(clean)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(OC_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    rows = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Deduplicate, drop self-references, and cap before the (costly) enrichment.
  const seen = new Set([clean]);
  const dois = [];
  for (const row of rows) {
    const d = extractDoi(row?.[field]);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    dois.push(d);
    if (dois.length >= limit) break;
  }
  if (dois.length === 0) return [];

  const enriched = await enrichDois(dois);
  return dois.map((d) => enriched.get(d) || stubPaper(d));
}

export default { getCitationGraph };
