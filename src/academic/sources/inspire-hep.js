/**
 * INSPIRE-HEP — the high-energy physics literature database (CERN/DESY/Fermilab
 * /SLAC). Free JSON REST API, no key, full OA links.
 * Docs: https://github.com/inspirehep/rest-api-doc
 */

import { withTimeout } from "./_ojs.js";

export const id = "inspire_hep";
export const name = "INSPIRE-HEP (High-Energy Physics)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["physics", "high_energy_physics", "astrophysics", "open_access"];

const API = "https://inspirehep.net/api/literature";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;

  let q = query;
  if (year_min && year_max) q += ` and de ${year_min}->${year_max}`;
  else if (year_min) q += ` and de ${year_min}->`;
  else if (year_max) q += ` and de ->${year_max}`;

  const params = new URLSearchParams({
    q,
    size: String(Math.min(limit, 100)),
    sort: sort === "recency" ? "mostrecent" : sort === "citations" ? "mostcited" : "bestmatch",
    fields: "titles,authors,earliest_date,dois,arxiv_eprints,abstracts,citation_count,publication_info,documents,control_number,document_type",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const hits = data?.hits?.hits || [];

    const papers = hits.slice(0, limit).map((h) => {
      const m = h.metadata || {};
      const pub = (m.publication_info || [])[0] || {};
      const arxivId = (m.arxiv_eprints || [])[0]?.value || null;
      const doi = (m.dois || [])[0]?.value || null;
      const year = m.earliest_date ? parseInt(String(m.earliest_date).slice(0, 4), 10) : null;
      const doc = (m.documents || []).find((d) => d.url);

      return {
        id: doi ? `doi:${doi}` : `inspire_hep:${m.control_number || h.id}`,
        title: (m.titles || [])[0]?.title || "",
        authors: (m.authors || []).slice(0, 10).map((a) => a.full_name).filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: arxivId,
        abstract: (m.abstracts || [])[0]?.value || null,
        citation_count: m.citation_count ?? null,
        pdf_url: arxivId
          ? `https://arxiv.org/pdf/${String(arxivId).replace(/v\d+$/, "")}.pdf`
          : doc?.url || null,
        url: `https://inspirehep.net/literature/${m.control_number || h.id}`,
        source: "inspire_hep",
        venue: pub.journal_title || "INSPIRE-HEP",
        volume: pub.journal_volume || null,
        issue: pub.journal_issue || null,
        pages: pub.page_start ? `${pub.page_start}${pub.page_end ? `-${pub.page_end}` : ""}` : null,
        publisher: null,
        type: (m.document_type || []).includes("conference paper") ? "conference" : arxivId && !doi ? "preprint" : "article",
        issn: null,
        is_oa: Boolean(arxivId || doc?.url),
      };
    }).filter((p) => p.title);

    return { papers, total: data?.hits?.total ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[inspire_hep] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchInspireHep };
