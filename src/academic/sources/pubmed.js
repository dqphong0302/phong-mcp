/**
 * PubMed source plugin.
 * Free; NCBI_API_KEY improves rate limit 3→10 req/s.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25497/
 */

import { fromPubMed } from "../formatter.js";

export const id = "pubmed";
export const name = "PubMed";
export const requiresKey = false;
export const keyEnvVar = "NCBI_API_KEY";
export const domains = ["medicine", "bio", "chemistry"];

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

let _lastCallAt = 0;
async function throttle(apiKey) {
  const minInterval = apiKey ? 120 : 380;
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < minInterval) await new Promise((r) => setTimeout(r, minInterval - elapsed));
  _lastCallAt = Date.now();
}

function addApiKey(params, apiKey, email) {
  if (apiKey) params.set("api_key", apiKey);
  params.set("tool", "phong-mcp");
  params.set("email", email || process.env.UNPAYWALL_EMAIL || "research@example.com");
}

function parsePubMedXml(xml) {
  const articles = [];
  const articleRe = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRe.exec(xml)) !== null) {
    const block = match[1];
    const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/.exec(block);
    const pmid = pmidMatch?.[1] || null;
    const titleMatch = /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/.exec(block);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "(untitled)";
    const absMatch = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    const absParts = []; let am;
    while ((am = absMatch.exec(block)) !== null) absParts.push(am[1].replace(/<[^>]+>/g, "").trim());
    const authorRe = /<LastName>(.*?)<\/LastName>[\s\S]*?(?:<ForeName>(.*?)<\/ForeName>)?/g;
    const authors = []; let ar;
    while ((ar = authorRe.exec(block)) !== null) { const last = ar[1]?.trim(); const first = ar[2]?.trim(); if (last) authors.push(first ? `${first} ${last}` : last); }
    const yearMatch = /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/.exec(block);
    const journalMatch = /<Title>(.*?)<\/Title>/.exec(block);
    const doiMatch = /<ArticleId IdType="doi">(.*?)<\/ArticleId>/.exec(block);
    const volumeMatch = /<Volume>(\d+)<\/Volume>/.exec(block);
    const issueMatch = /<Issue>(.*?)<\/Issue>/.exec(block);
    const pagesMatch = /<MedlinePgn>(.*?)<\/MedlinePgn>/.exec(block);
    const issnMatch = /<ISSN[^>]*>([\d\-X]+)<\/ISSN>/.exec(block);

    // Extract MeSH Headings
    const mesh_terms = [];
    const meshRe = /<MeshHeading>([\s\S]*?)<\/MeshHeading>/g;
    let mm;
    while ((mm = meshRe.exec(block)) !== null) {
      const descMatch = /<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/.exec(mm[1]);
      if (descMatch) {
        const isMajor = /MajorTopicYN="Y"/.test(descMatch[0]);
        let term = descMatch[1].replace(/<[^>]+>/g, "").trim();
        const qualMatch = /<QualifierName[^>]*>([\s\S]*?)<\/QualifierName>/.exec(mm[1]);
        if (qualMatch) {
          term += `/${qualMatch[1].replace(/<[^>]+>/g, "").trim()}`;
        }
        if (isMajor) term += "*";
        mesh_terms.push(term);
      }
    }

    // Extract Publication Types (e.g. Randomized Controlled Trial, Meta-Analysis, Review)
    const publication_types = [];
    const ptRe = /<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g;
    let pm;
    while ((pm = ptRe.exec(block)) !== null) {
      const pt = pm[1].replace(/<[^>]+>/g, "").trim();
      if (pt && !publication_types.includes(pt)) publication_types.push(pt);
    }

    // Extract Author Keywords
    const keywords = [];
    const kwRe = /<Keyword[^>]*>([\s\S]*?)<\/Keyword>/g;
    let km;
    while ((km = kwRe.exec(block)) !== null) {
      const kw = km[1].replace(/<[^>]+>/g, "").trim();
      if (kw && !keywords.includes(kw)) keywords.push(kw);
    }

    if (pmid) {
      articles.push({
        pmid,
        title,
        abstract: absParts.join(" ") || null,
        authors,
        year: yearMatch ? parseInt(yearMatch[1], 10) : null,
        journal: journalMatch?.[1]?.trim() || null,
        doi: doiMatch?.[1]?.trim() || null,
        volume: volumeMatch?.[1] || null,
        issue: issueMatch?.[1]?.trim() || null,
        pages: pagesMatch?.[1]?.trim() || null,
        issn: issnMatch?.[1]?.trim() || null,
        mesh_terms: mesh_terms.length > 0 ? mesh_terms : null,
        publication_types: publication_types.length > 0 ? publication_types : null,
        keywords: keywords.length > 0 ? keywords : null,
      });
    }
  }
  return articles;
}

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;
  const apiKey = config.ncbiApiKey;
  await throttle(apiKey);
  const searchParams = new URLSearchParams({ db: "pubmed", term: query, retmax: String(Math.min(limit, 100)), retmode: "json", sort: sort === "recency" ? "pub date" : "relevance" });
  if (year_min || year_max) { searchParams.set("datetype", "pdat"); searchParams.set("mindate", `${year_min || 1900}/01/01`); searchParams.set("maxdate", `${year_max || new Date().getFullYear()}/12/31`); }
  addApiKey(searchParams, apiKey, config.unpaywallEmail);
  const searchResp = await fetch(`${ESEARCH}?${searchParams}`, { signal: AbortSignal.timeout(20000) });
  if (!searchResp.ok) throw new Error(`PubMed search HTTP ${searchResp.status}`);
  const searchData = await searchResp.json();
  const ids = searchData.esearchresult?.idlist || [];
  const total = parseInt(searchData.esearchresult?.count || "0", 10);
  if (!ids.length) return { papers: [], total };
  await throttle(apiKey);
  const fetchParams = new URLSearchParams({ db: "pubmed", id: ids.join(","), rettype: "abstract", retmode: "xml" });
  addApiKey(fetchParams, apiKey, config.unpaywallEmail);
  const fetchResp = await fetch(`${EFETCH}?${fetchParams}`, { signal: AbortSignal.timeout(30000) });
  if (!fetchResp.ok) throw new Error(`PubMed fetch HTTP ${fetchResp.status}`);
  return { papers: parsePubMedXml(await fetchResp.text()).map(fromPubMed), total };
}

export async function getById(pmid, config = {}) {
  const apiKey = config.ncbiApiKey;
  await throttle(apiKey);
  const fetchParams = new URLSearchParams({ db: "pubmed", id: String(pmid), rettype: "abstract", retmode: "xml" });
  addApiKey(fetchParams, apiKey, config.unpaywallEmail);
  const resp = await fetch(`${EFETCH}?${fetchParams}`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) return null;
  const articles = parsePubMedXml(await resp.text());
  return articles.length > 0 ? fromPubMed(articles[0]) : null;
}

export { search as searchPubMed, getById as getPubMedArticle };
