/**
 * PubMed E-utilities client for biomedical literature search.
 * Free; register at ncbi.nlm.nih.gov/account for higher rate limit (10/s vs 3/s).
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25497/
 */

import { fromPubMed } from "./formatter.js";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

// Rate limit: 3 req/s without key, 10 req/s with key
let _lastCallAt = 0;

async function throttle(apiKey) {
  const minInterval = apiKey ? 120 : 380; // ms
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < minInterval) await new Promise((r) => setTimeout(r, minInterval - elapsed));
  _lastCallAt = Date.now();
}

function addApiKey(params, apiKey) {
  if (apiKey) params.set("api_key", apiKey);
  params.set("tool", "phong-mcp");
  params.set("email", process.env.UNPAYWALL_EMAIL || "research@example.com");
}

/**
 * Parse PubMed XML (efetch rettype=abstract) into structured articles.
 *
 * @param {string} xml
 * @returns {Object[]}
 */
function parsePubMedXml(xml) {
  const articles = [];
  const articleRe = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;

  while ((match = articleRe.exec(xml)) !== null) {
    const block = match[1];

    // PMID
    const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/.exec(block);
    const pmid = pmidMatch ? pmidMatch[1] : null;

    // Title
    const titleMatch = /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/.exec(block);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "(untitled)";

    // Abstract
    const absMatch = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    const absParts = [];
    let am;
    while ((am = absMatch.exec(block)) !== null) {
      absParts.push(am[1].replace(/<[^>]+>/g, "").trim());
    }
    const abstract = absParts.join(" ") || null;

    // Authors
    const authorRe = /<LastName>(.*?)<\/LastName>[\s\S]*?(?:<ForeName>(.*?)<\/ForeName>)?/g;
    const authors = [];
    let ar;
    while ((ar = authorRe.exec(block)) !== null) {
      const last = ar[1]?.trim();
      const first = ar[2]?.trim();
      if (last) authors.push(first ? `${first} ${last}` : last);
    }

    // Year
    const yearMatch = /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/.exec(block);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Journal
    const journalMatch = /<Title>(.*?)<\/Title>/.exec(block);
    const journal = journalMatch ? journalMatch[1].trim() : null;

    // DOI
    const doiMatch = /<ArticleId IdType="doi">(.*?)<\/ArticleId>/.exec(block);
    const doi = doiMatch ? doiMatch[1].trim() : null;

    // Volume / Issue / Pages / ISSN
    const volumeMatch = /<Volume>(\d+)<\/Volume>/.exec(block);
    const volume = volumeMatch ? volumeMatch[1] : null;

    const issueMatch = /<Issue>(.*?)<\/Issue>/.exec(block);
    const issue = issueMatch ? issueMatch[1].trim() : null;

    const pagesMatch = /<MedlinePgn>(.*?)<\/MedlinePgn>/.exec(block);
    const pages = pagesMatch ? pagesMatch[1].trim() : null;

    const issnMatch = /<ISSN[^>]*>([\d\-X]+)<\/ISSN>/.exec(block);
    const issn = issnMatch ? issnMatch[1].trim() : null;

    if (pmid) {
      articles.push({ pmid, title, abstract, authors, year, journal, doi, volume, issue, pages, issn });
    }
  }

  return articles;
}

/**
 * Search PubMed using E-utilities.
 *
 * @param {string} query
 * @param {Object} opts
 * @param {number}  [opts.limit=10]
 * @param {string}  [opts.apiKey]
 * @param {number}  [opts.year_min]
 * @param {number}  [opts.year_max]
 * @param {"relevance"|"recency"} [opts.sort="relevance"]
 * @returns {Promise<{papers: import("./formatter.js").AcademicPaper[], total: number}>}
 */
export async function searchPubMed(query, opts = {}) {
  const { limit = 10, apiKey, year_min, year_max, sort = "relevance" } = opts;

  await throttle(apiKey);

  // Step 1: ESearch to get PMIDs
  const searchParams = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(Math.min(limit, 100)),
    retmode: "json",
    sort: sort === "recency" ? "pub date" : "relevance",
  });

  if (year_min || year_max) {
    const from = year_min || 1900;
    const to = year_max || new Date().getFullYear();
    searchParams.set("datetype", "pdat");
    searchParams.set("mindate", `${from}/01/01`);
    searchParams.set("maxdate", `${to}/12/31`);
  }

  addApiKey(searchParams, apiKey);

  const searchResp = await fetch(`${ESEARCH}?${searchParams}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!searchResp.ok) throw new Error(`PubMed search HTTP ${searchResp.status}`);

  const searchData = await searchResp.json();
  const ids = searchData.esearchresult?.idlist || [];
  const total = parseInt(searchData.esearchresult?.count || "0", 10);

  if (ids.length === 0) return { papers: [], total };

  // Step 2: EFetch to get abstracts
  await throttle(apiKey);

  const fetchParams = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    rettype: "abstract",
    retmode: "xml",
  });
  addApiKey(fetchParams, apiKey);

  const fetchResp = await fetch(`${EFETCH}?${fetchParams}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!fetchResp.ok) throw new Error(`PubMed fetch HTTP ${fetchResp.status}`);

  const xml = await fetchResp.text();
  const articles = parsePubMedXml(xml);

  return {
    papers: articles.map(fromPubMed),
    total,
  };
}

/**
 * Get single PubMed article by PMID.
 *
 * @param {string|number} pmid
 * @param {string} [apiKey]
 * @returns {Promise<import("./formatter.js").AcademicPaper|null>}
 */
export async function getPubMedArticle(pmid, apiKey) {
  await throttle(apiKey);

  const fetchParams = new URLSearchParams({
    db: "pubmed",
    id: String(pmid),
    rettype: "abstract",
    retmode: "xml",
  });
  addApiKey(fetchParams, apiKey);

  const resp = await fetch(`${EFETCH}?${fetchParams}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) return null;

  const xml = await resp.text();
  const articles = parsePubMedXml(xml);
  return articles.length > 0 ? fromPubMed(articles[0]) : null;
}
