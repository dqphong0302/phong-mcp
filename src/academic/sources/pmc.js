/**
 * PubMed Central (PMC) — NCBI's full-text archive of biomedical literature.
 *
 * Why this exists next to `pubmed` and `europe_pmc`: those return abstracts.
 * PMC returns the *full text*, which is what evidence checking, PRISMA
 * screening and meta-analysis actually need. Every record here is in the OA
 * subset or free-to-read.
 *
 * Free, no key. NCBI_API_KEY is honoured when present (raises the rate limit
 * from 3 to 10 requests/second).
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
 */

import { withTimeout, stripHtml } from "./_ojs.js";
import { contentTermsRaw } from "./_relevance.js";

export const id = "pmc";
export const name = "PubMed Central (PMC — full text, OA subset)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["biomedical", "medicine", "life_sciences", "clinical", "open_access"];

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function keyParams(config) {
  const k = config.ncbiApiKey || process.env.NCBI_API_KEY;
  // NCBI rejects an empty `email=` parameter — only send it when set.
  const p = { tool: "academic-search-mcp" };
  const email = process.env.UNPAYWALL_EMAIL;
  if (email) p.email = email;
  if (k) p.api_key = k;
  return p;
}

/**
 * Turn a natural-language query into an E-utilities term restricted to title
 * and abstract. Falls back to the raw query when nothing is left to constrain
 * (e.g. a query made entirely of stopwords).
 *
 * @param {string} query
 * @returns {string}
 */
function buildTiabTerm(query) {
  const terms = contentTermsRaw(query);
  if (terms.length === 0) return query;
  return terms.map((t) => `${t}[TIAB]`).join(" AND ");
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance", signal } = opts;

  // The `pmc` database searches FULL TEXT, so a free-text query matches any
  // paper that merely mentions the topic in its discussion or reference list —
  // a GLP-1 cardiovascular search came back with a paper on endometrial cancer.
  // Constraining each content term to title/abstract cuts that from ~24,700
  // hits to ~500 without losing the papers actually about the subject.
  let term = buildTiabTerm(query);
  if (year_min || year_max) term += ` AND ("${year_min || 1800}"[PDAT] : "${year_max || 3000}"[PDAT])`;

  const esearch = new URLSearchParams({
    db: "pmc", term, retmode: "json",
    // Over-fetch: the `pmc` database searches FULL TEXT, so a paper qualifies
    // by mentioning the topic once in its discussion or reference list. Those
    // are screened out below and the headroom keeps the caller's count intact.
    retmax: String(Math.min(Math.max(limit * 4, 20), 100)),
    ...keyParams(config),
  });
  if (sort === "recency") esearch.set("sort", "pub_date");

  try {
    const sResp = await fetch(`${EUTILS}/esearch.fcgi?${esearch}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!sResp.ok) return { papers: [], total: 0 };
    const sData = await sResp.json();
    const ids = sData?.esearchresult?.idlist || [];
    const total = parseInt(sData?.esearchresult?.count, 10);
    if (!ids.length) return { papers: [], total: Number.isFinite(total) ? total : 0 };

    const esummary = new URLSearchParams({
      db: "pmc", id: ids.join(","), retmode: "json", ...keyParams(config),
    });
    const dResp = await fetch(`${EUTILS}/esummary.fcgi?${esummary}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!dResp.ok) return { papers: [], total: Number.isFinite(total) ? total : 0 };
    const result = (await dResp.json())?.result || {};

    const papers = [];
    for (const uid of ids) {
      const r = result[uid];
      if (!r || !r.title) continue;
      const pmcid = `PMC${uid}`;
      const artIds = r.articleids || [];
      const doi = artIds.find((a) => a.idtype === "doi")?.value || null;
      const pmid = artIds.find((a) => a.idtype === "pmid")?.value || null;
      const year = r.pubdate ? parseInt(String(r.pubdate).slice(0, 4), 10) : null;

      papers.push({
        id: doi ? `doi:${doi}` : `pmc:${pmcid}`,
        title: stripHtml(r.title),
        authors: (r.authors || []).map((a) => a.name).filter(Boolean),
        year: Number.isFinite(year) ? year : null,
        doi,
        arxiv_id: null,
        // esummary carries no abstract; fetchFullText() below pulls the real
        // one. Never synthesise placeholder text here.
        abstract: null,
        citation_count: null,
        pdf_url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`,
        url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
        source: "pmc",
        venue: r.fulljournalname || r.source || "PubMed Central",
        volume: r.volume || null,
        issue: r.issue || null,
        pages: r.pages || null,
        publisher: null,
        type: "article",
        issn: r.issn || r.essn || null,
        is_oa: true,
        pmcid,
        pmid,
      });
      if (papers.length >= limit) break;
    }

    return { papers: papers.slice(0, limit), total: Number.isFinite(total) ? total : papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[pmc] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

/**
 * Fetch the full text of a PMC article as plain text (JATS XML stripped).
 * This is the point of the source — call it for evidence checking and
 * data extraction rather than reasoning from an abstract.
 *
 * @param {string} pmcid  - "PMC1234567" or the bare numeric id
 * @returns {Promise<{pmcid: string, title: string|null, abstract: string|null, body: string|null}|null>}
 */
export async function fetchFullText(pmcid, config = {}, opts = {}) {
  const uid = String(pmcid).replace(/^pmc:?/i, "").replace(/^PMC/i, "");
  const params = new URLSearchParams({ db: "pmc", id: uid, rettype: "xml", retmode: "xml", ...keyParams(config) });

  try {
    const resp = await fetch(`${EUTILS}/efetch.fcgi?${params}`, {
      headers: { Accept: "application/xml", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(opts.signal, 25000),
    });
    if (!resp.ok) return null;
    const xml = await resp.text();

    const section = (tag) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? stripHtml(m[1]) : null;
    };

    const body = section("body");
    const abstract = section("abstract");
    if (!body && !abstract) return null;

    return {
      pmcid: `PMC${uid}`,
      title: section("article-title"),
      abstract,
      body,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a DOI / PMID / PMCID to a PMCID using NCBI's ID Converter.
 * Returns null when the work is not in PMC (i.e. no free full text).
 * Docs: https://www.ncbi.nlm.nih.gov/pmc/tools/id-converter-api/
 */
export async function resolvePmcid(rawId, config = {}, opts = {}) {
  const id = String(rawId || "").trim().replace(/^doi:/i, "");
  if (!id) return null;
  if (/^PMC\d+$/i.test(id)) return id.toUpperCase();

  const params = new URLSearchParams({
    ids: id, format: "json", tool: "academic-search-mcp",
  });
  const email = process.env.UNPAYWALL_EMAIL;
  if (email) params.set("email", email);

  try {
    const resp = await fetch(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(opts.signal, 12000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const rec = (data?.records || [])[0];
    return rec?.pmcid || null;
  } catch {
    return null;
  }
}

export async function getById(paperId, config = {}, opts = {}) {
  const uid = String(paperId).replace(/^pmc:/i, "").replace(/^PMC/i, "");
  if (!/^\d+$/.test(uid)) return null;
  const r = await search(`PMC${uid}[pmcid]`, { limit: 1, signal: opts.signal }, config);
  return r.papers[0] || null;
}

export { search as searchPmc };
