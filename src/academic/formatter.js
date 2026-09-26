import { getJournalQuartile } from "./quartile.js";
import { generateTakeaway } from "./takeaway.js";
import { calculateAcademicConsensus } from "./consensus.js";

/**
 * Academic search result normalizer.
 * Converts source-specific payloads into a unified AcademicPaper shape.
 * Sources: openalex, semantic_scholar, arxiv, pubmed, crossref, europe_pmc,
 *          dblp, core, doaj, openaire, scopus, ieee, springer
 */

/**
 * @typedef {Object} AcademicPaper
 * @property {string}       id             - Canonical ID (DOI preferred, else source:id)
 * @property {string}       title
 * @property {string[]}     authors
 * @property {number|null}  year
 * @property {string|null}  doi
 * @property {string|null}  arxiv_id
 * @property {string|null}  abstract
 * @property {number|null}  citation_count
 * @property {string|null}  pdf_url        - Open Access PDF URL if available
 * @property {string|null}  url            - Landing page URL
 * @property {string}       source         - Source identifier
 * @property {string|null}  venue          - Journal / conference name
 * @property {string|null}  tldr           - AI-generated summary (Semantic Scholar only)
 * @property {string|null}  volume         - Journal volume number
 * @property {string|null}  issue          - Journal issue / number
 * @property {string|null}  pages          - Page range, e.g. "123-145"
 * @property {string|null}  publisher      - Publisher name
 * @property {string}       type           - "article"|"conference"|"preprint"|"book_chapter"|"other"
 * @property {string|null}  issn           - ISSN of the journal
 * @property {boolean}      is_oa          - True if open access
 */

// ── OpenAlex ──────────────────────────────────────────────────────────────────

function reconstructAbstract(inv) {
  if (!inv || typeof inv !== "object") return null;
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ") || null;
}

export function fromOpenAlex(work) {
  const doi = work.doi ? work.doi.replace("https://doi.org/", "") : null;
  const authors = (work.authorships || [])
    .slice(0, 6)
    .map((a) => a.author?.display_name)
    .filter(Boolean);
  const oa = work.open_access || {};
  // oa_url is sometimes a graphical-abstract image (ars.els-cdn.com/…-ga1_lrg.jpg), not a PDF.
  const pdfUrl = [oa.oa_url, work.primary_location?.pdf_url]
    .find((u) => u && !/\.(?:jpe?g|png|gif|webp|svg|tiff?)(?:[?#]|$)/i.test(u)) || null;
  const biblio = work.biblio || {};
  const pages = biblio.first_page && biblio.last_page
    ? `${biblio.first_page}-${biblio.last_page}`
    : biblio.first_page || null;
  return {
    id: doi ? `doi:${doi}` : `openalex:${work.id}`,
    title: work.display_name || work.title || "(untitled)",
    authors,
    year: work.publication_year || null,
    doi,
    arxiv_id: null,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    citation_count: work.cited_by_count ?? null,
    pdf_url: pdfUrl,
    url: work.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : null),
    source: "openalex",
    venue: work.primary_location?.source?.display_name || null,
    tldr: null,
    volume: biblio.volume || null,
    issue: biblio.issue || null,
    pages,
    publisher: null,
    type: work.type === "preprint" ? "preprint" : "article",
    issn: null,
    is_oa: Boolean(oa.is_oa),
  };
}

// ── Semantic Scholar ──────────────────────────────────────────────────────────

export function fromSemanticScholar(paper) {
  const doi = paper.externalIds?.DOI || null;
  const arxiv_id = paper.externalIds?.ArXiv || null;
  const authors = (paper.authors || []).slice(0, 6).map((a) => a.name).filter(Boolean);
  const pdfUrl = paper.openAccessPdf?.url ||
    (arxiv_id ? `https://arxiv.org/pdf/${arxiv_id}.pdf` : null);
  return {
    id: doi ? `doi:${doi}` : `s2:${paper.paperId}`,
    title: paper.title || "(untitled)",
    authors,
    year: paper.year || null,
    doi,
    arxiv_id,
    abstract: paper.abstract || null,
    citation_count: paper.citationCount ?? paper.influentialCitationCount ?? null,
    pdf_url: pdfUrl,
    url: paper.url || (doi ? `https://doi.org/${doi}` : null) ||
      (arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : null),
    source: "semantic_scholar",
    venue: paper.venue || paper.journal?.name || null,
    tldr: paper.tldr?.text || null,
    volume: paper.journal?.volume || null,
    issue: null,
    pages: paper.journal?.pages || null,
    publisher: null,
    type: arxiv_id ? "preprint" : "article",
    issn: null,
    is_oa: Boolean(pdfUrl),
  };
}

// ── arXiv ─────────────────────────────────────────────────────────────────────

export function fromArxiv(entry) {
  const rawId = entry.id || "";
  const arxiv_id = rawId.replace(/.*abs\//, "").replace(/v\d+$/, "").trim();
  const authors = (Array.isArray(entry.author) ? entry.author : [entry.author])
    .slice(0, 6)
    .map((a) => (typeof a === "string" ? a : a?.name))
    .filter(Boolean);
  const publishedRaw = entry.published || "";
  const year = publishedRaw ? parseInt(publishedRaw.slice(0, 4), 10) || null : null;
  return {
    id: `arxiv:${arxiv_id}`,
    title: (entry.title || "(untitled)").replace(/\s+/g, " ").trim(),
    authors,
    year,
    doi: null,
    arxiv_id,
    abstract: (entry.summary || "").replace(/\s+/g, " ").trim() || null,
    citation_count: null,
    pdf_url: `https://arxiv.org/pdf/${arxiv_id}.pdf`,
    url: `https://arxiv.org/abs/${arxiv_id}`,
    source: "arxiv",
    venue: "arXiv",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    type: "preprint",
    issn: null,
    is_oa: true,
  };
}

// ── PubMed ────────────────────────────────────────────────────────────────────

export function fromPubMed(article) {
  return {
    id: `pmid:${article.pmid}`,
    title: article.title || "(untitled)",
    authors: (article.authors || []).slice(0, 6),
    year: article.year || null,
    doi: article.doi || null,
    arxiv_id: null,
    abstract: article.abstract || null,
    citation_count: null,
    pdf_url: null,
    url: article.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/` : null,
    source: "pubmed",
    venue: article.journal || null,
    tldr: null,
    volume: article.volume || null,
    issue: article.issue || null,
    pages: article.pages || null,
    publisher: null,
    type: "article",
    issn: article.issn || null,
    is_oa: false,
    mesh_terms: article.mesh_terms || null,
    publication_types: article.publication_types || null,
    keywords: article.keywords || null,
  };
}

// ── Crossref ──────────────────────────────────────────────────────────────────

/** Strip JATS XML tags from Crossref abstracts (e.g. "<jats:p>text</jats:p>") */
function stripJatsXml(str) {
  if (!str) return null;
  return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export function fromCrossref(item) {
  const doi = item.DOI || null;
  const authors = (item.author || [])
    .slice(0, 6)
    .map((a) => `${a.given || ""} ${a.family || ""}`.trim())
    .filter(Boolean);
  const yearParts =
    item.published?.["date-parts"]?.[0] || item.created?.["date-parts"]?.[0] || [];
  const year = yearParts[0] || null;
  let pdf_url = null;
  if (item.link && Array.isArray(item.link)) {
    const pdfLink = item.link.find(
      (l) => l["content-type"] === "application/pdf" && l["intended-application"] !== "text-mining"
    );
    if (pdfLink) pdf_url = pdfLink.URL;
  }
  const typeMap = {
    "journal-article": "article",
    "proceedings-article": "conference",
    "book-chapter": "book_chapter",
    "preprint": "preprint",
    "posted-content": "preprint",
  };
  const issns = item.ISSN || [];
  return {
    id: doi ? `doi:${doi}` : `crossref:${item.URL || Math.random()}`,
    title: (item.title && item.title[0]) || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: stripJatsXml(item.abstract) || null,
    citation_count: item["is-referenced-by-count"] ?? null,
    pdf_url,
    url: item.URL || (doi ? `https://doi.org/${doi}` : null),
    source: "crossref",
    venue: (item["container-title"] && item["container-title"][0]) || null,
    tldr: null,
    volume: item.volume || null,
    issue: item.issue || null,
    pages: item.page || null,
    publisher: item.publisher || null,
    type: typeMap[item.type] || "article",
    issn: issns[0] || null,
    is_oa: Boolean(pdf_url),
  };
}

// ── Europe PMC ────────────────────────────────────────────────────────────────

export function fromEuropePMC(item) {
  const doi = item.doi || null;
  const authors =
    item.authorList?.author
      ?.map((a) => a.fullName || `${a.firstName || ""} ${a.lastName || ""}`.trim())
      .filter(Boolean) || [item.authorString].filter(Boolean);
  const isOA = item.isOpenAccess === "Y";
  let pdf_url = null;
  if (isOA && item.pmcid) {
    pdf_url = `https://europepmc.org/articles/${item.pmcid}?pdf=render`;
  }
  return {
    id: doi ? `doi:${doi}` : item.pmid ? `pmid:${item.pmid}` : `epmc:${item.id || Math.random()}`,
    title: item.title || "(untitled)",
    authors,
    year: parseInt(item.pubYear, 10) || null,
    doi,
    arxiv_id: null,
    abstract: item.abstractText || null,
    citation_count: item.citedByCount ?? null,
    pdf_url,
    url: item.pmid
      ? `https://europepmc.org/article/MED/${item.pmid}`
      : doi ? `https://doi.org/${doi}` : null,
    source: "europe_pmc",
    venue: item.journalTitle || null,
    tldr: null,
    volume: item.journalVolume || item.volume || null,
    issue: item.issue || null,
    pages: item.pageInfo || null,
    publisher: null,
    type: "article",
    issn: item.issn || null,
    is_oa: isOA,
  };
}

// ── DBLP ──────────────────────────────────────────────────────────────────────

export function fromDBLP(info) {
  if (!info) return null;
  let authors = [];
  if (info.authors?.author) {
    const arr = Array.isArray(info.authors.author) ? info.authors.author : [info.authors.author];
    authors = arr.map((a) => (typeof a === "string" ? a : a.text)).filter(Boolean);
  }
  const doi = info.doi || null;
  return {
    id: doi ? `doi:${doi}` : info.key ? `dblp:${info.key}` : `dblp:${info.url || Math.random()}`,
    title: info.title || "(untitled)",
    authors,
    year: parseInt(info.year, 10) || null,
    doi,
    arxiv_id: null,
    abstract: null,
    citation_count: null,
    pdf_url: null,
    url: info.ee || info.url || null,
    source: "dblp",
    venue: info.venue || null,
    tldr: null,
    volume: info.volume || null,
    issue: info.number || null,
    pages: info.pages || null,
    publisher: info.publisher || null,
    type: info.type === "Proceedings" ? "conference" : "article",
    issn: null,
    is_oa: false,
  };
}
// ── CORE ──────────────────────────────────────────────────────────────────────

export function fromCORE(result) {
  const doi = result.doi || null;
  const authors = (result.authors || [])
    .slice(0, 6)
    .map((a) => (typeof a === "string" ? a : a.name || a.fullName))
    .filter(Boolean);
  const year = result.publishedDate
    ? parseInt(result.publishedDate.slice(0, 4), 10) || null
    : result.yearPublished || null;
  const pdf_url = result.downloadUrl || result.fullTextIdentifier || null;
  return {
    id: doi ? `doi:${doi}` : `core:${result.id}`,
    title: result.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: result.abstract || null,
    citation_count: result.citationCount ?? null,
    pdf_url,
    url: result.sourceFulltextUrls?.[0] || pdf_url || (doi ? `https://doi.org/${doi}` : `https://core.ac.uk/works/${result.id}`),
    source: "core",
    venue: result.journals?.[0]?.title || result.publisher || null,
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: result.publisher || null,
    type: "article",
    issn: null,
    is_oa: true,
  };
}

// ── DOAJ ──────────────────────────────────────────────────────────────────────

export function fromDOAJ(result) {
  const bib = result.bibjson || {};
  const doiEntry = (bib.identifier || []).find((i) => i.type === "doi");
  const doi = doiEntry?.id || null;
  const authors = (bib.author || []).slice(0, 6).map((a) => a.name).filter(Boolean);
  const year = bib.year ? parseInt(bib.year, 10) || null : null;
  const ftLink = (bib.link || []).find((l) => l.type === "fulltext");
  const pdf_url = ftLink?.url || null;
  const issnEntry = (bib.identifier || []).find((i) => i.type === "eissn" || i.type === "pissn");
  return {
    id: doi ? `doi:${doi}` : `doaj:${result.id}`,
    title: bib.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: bib.abstract || null,
    citation_count: null,
    pdf_url,
    url: pdf_url || (doi ? `https://doi.org/${doi}` : `https://doaj.org/article/${result.id}`),
    source: "doaj",
    venue: bib.journal?.title || null,
    tldr: null,
    volume: bib.journal?.volume || null,
    issue: bib.journal?.number || null,
    pages: bib.start_page && bib.end_page ? `${bib.start_page}-${bib.end_page}` : null,
    publisher: null,
    type: "article",
    issn: issnEntry?.id || null,
    is_oa: true,
  };
}

// ── OpenAIRE ──────────────────────────────────────────────────────────────────

export function fromOpenAIRE(result) {
  const pids = result.pids || [];
  const doiPid = pids.find((p) => p.scheme === "doi" || p.type === "doi");
  const doi = doiPid?.value || doiPid?.id || null;
  const authors = (result.authors || []).slice(0, 6).map((a) => a.fullName || a.name).filter(Boolean);
  const year = result.publicationDate ? parseInt(result.publicationDate.slice(0, 4), 10) || null : null;
  const title = result.mainTitle || result.titles?.[0]?.value || "(untitled)";
  let abstract = null;
  if (typeof result.description === "string") abstract = result.description || null;
  else if (Array.isArray(result.description)) abstract = result.description[0]?.value || result.description[0] || null;
  else if (result.descriptions?.[0]) abstract = result.descriptions[0].value || result.descriptions[0] || null;
  const isOA = result.bestAccessRight?.code === "OPEN";
  const pdf_url = isOA ? (result.downloadURLs?.[0] || null) : null;
  return {
    id: doi ? `doi:${doi}` : `openaire:${result.id}`,
    title,
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract,
    citation_count: result.citationCount ?? null,
    pdf_url,
    url: doi ? `https://doi.org/${doi}` :
      result.originalIds?.[0] || `https://explore.openaire.eu/search/publication?articleId=${result.id}`,
    source: "openaire",
    venue: result.sources?.[0]?.title || result.publisher || null,
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: result.publisher || null,
    type: "article",
    issn: null,
    is_oa: isOA,
  };
}

// ── Scopus ────────────────────────────────────────────────────────────────────

export function fromScopus(entry) {
  const doi = entry["prism:doi"] || null;
  const authorArr = entry.author || [];
  const authors = authorArr.length > 0
    ? authorArr.slice(0, 6)
        .map((a) => `${a["given-name"] || ""} ${a["surname"] || ""}`.trim())
        .filter(Boolean)
    : [entry["dc:creator"]].filter(Boolean);
  const coverDate = entry["prism:coverDate"] || "";
  const year = coverDate ? parseInt(coverDate.slice(0, 4), 10) || null : null;
  const isOA = entry.openaccess === "1" || entry.openaccess === 1;
  const eid = entry["dc:identifier"] || "";
  return {
    id: doi ? `doi:${doi}` : `scopus:${eid}`,
    title: entry["dc:title"] || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: entry["dc:description"] || null,
    citation_count: parseInt(entry["citedby-count"] || "0", 10) || null,
    pdf_url: isOA ? (entry["prism:url"] || null) : null,
    url: doi ? `https://doi.org/${doi}` : (entry["prism:url"] || null),
    source: "scopus",
    venue: entry["prism:publicationName"] || null,
    tldr: null,
    volume: entry["prism:volume"] || null,
    issue: entry["prism:issueIdentifier"] || null,
    pages: entry["prism:pageRange"] || null,
    publisher: "Elsevier / Scopus-indexed",
    type: (entry.subtypeDescription || "").toLowerCase().includes("conference") ? "conference" : "article",
    issn: entry["prism:issn"] || null,
    is_oa: isOA,
  };
}

// ── IEEE Xplore ───────────────────────────────────────────────────────────────

export function fromIEEE(article) {
  const doi = article.doi || null;
  const authors = (article.authors?.authors || [])
    .slice(0, 6)
    .map((a) => a.full_name || a.author_name)
    .filter(Boolean);
  const pages = article.start_page && article.end_page
    ? `${article.start_page}-${article.end_page}`
    : article.start_page || null;
  const isOA = Boolean(article.is_open_access);
  return {
    id: doi ? `doi:${doi}` : `ieee:${article.article_number}`,
    title: article.title || "(untitled)",
    authors,
    year: article.publication_year ? parseInt(article.publication_year, 10) || null : null,
    doi,
    arxiv_id: null,
    abstract: article.abstract || null,
    citation_count: article.article_citation_count ?? article.citing_paper_count ?? null,
    pdf_url: isOA && article.pdf_url ? article.pdf_url : null,
    url: article.html_url || (doi ? `https://doi.org/${doi}` : null),
    source: "ieee",
    venue: article.publication_title || null,
    tldr: null,
    volume: article.volume ? String(article.volume) : null,
    issue: article.issue ? String(article.issue) : null,
    pages,
    publisher: "IEEE",
    type: article.content_type === "Conferences" ? "conference" : "article",
    issn: article.issn || null,
    is_oa: isOA,
  };
}

// ── Springer Nature ───────────────────────────────────────────────────────────

export function fromSpringer(record) {
  const doi = record.doi || null;
  const authors = (record.creators || []).slice(0, 6).map((c) => c.creator).filter(Boolean);
  const pubDate = record.publicationDate || record.onlineDate || "";
  const year = pubDate ? parseInt(pubDate.slice(0, 4), 10) || null : null;
  const pages = record.startingPage && record.endingPage
    ? `${record.startingPage}-${record.endingPage}`
    : record.startingPage || null;
  const isOA = record.openAccess === true || record.openAccess === "true";
  const urlVal = Array.isArray(record.url) ? record.url[0]?.value : record.url || null;
  return {
    id: doi ? `doi:${doi}` : `springer:${record.identifier || Math.random()}`,
    title: record.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: record.abstract || null,
    citation_count: null,
    pdf_url: isOA && urlVal ? urlVal : null,
    url: doi ? `https://doi.org/${doi}` : urlVal,
    source: "springer",
    venue: record.publicationName || null,
    tldr: null,
    volume: record.volume || null,
    issue: record.number || null,
    pages,
    publisher: "Springer Nature",
    type: (record.contentType || "").toLowerCase().includes("chapter") ? "book_chapter" : "article",
    issn: record.issn || null,
    is_oa: isOA,
  };
}

// ── Papers With Code ──────────────────────────────────────────────────────────

export function fromPapersWithCode(paper) {
  const arxiv_id = paper.arxiv_id || null;
  const authors = (paper.authors || []).slice(0, 6).map((a) => a.name || a).filter(Boolean);
  const year = paper.published ? parseInt(paper.published.slice(0, 4), 10) || null : null;
  const pdf_url = arxiv_id ? `https://arxiv.org/pdf/${arxiv_id}.pdf` : null;
  return {
    id: arxiv_id ? `arxiv:${arxiv_id}` : `pwc:${paper.id}`,
    title: paper.title || "(untitled)",
    authors,
    year,
    doi: null,
    arxiv_id,
    abstract: paper.abstract || null,
    citation_count: paper.citations || null,
    pdf_url,
    url: paper.url_abs || (arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : `https://paperswithcode.com/paper/${paper.id}`),
    source: "papers_with_code",
    venue: paper.proceeding || null,
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    type: "preprint",
    issn: null,
    is_oa: Boolean(arxiv_id),
    // PapersWithCode-specific extras
    github_url: paper.repository?.url || paper.github_url || null,
    tasks: (paper.tasks || []).map((t) => t.name || t).filter(Boolean),
  };
}

// ── Dimensions ────────────────────────────────────────────────────────────────

export function fromDimensions(pub) {
  const doi = pub.doi || null;
  const authors = (pub.authors || []).slice(0, 6).map((a) => {
    const parts = [a.first_name, a.last_name].filter(Boolean);
    return parts.join(" ") || a.researcher_id || null;
  }).filter(Boolean);
  const year = pub.year || null;
  const journal = pub.journal?.title || pub.source_title || null;
  const isOA = Boolean(pub.open_access);
  return {
    id: doi ? `doi:${doi}` : `dimensions:${pub.id}`,
    title: pub.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: pub.abstract || null,
    citation_count: pub.times_cited ?? null,
    pdf_url: null,
    url: doi ? `https://doi.org/${doi}` : null,
    source: "dimensions",
    venue: journal,
    tldr: null,
    volume: pub.volume || null,
    issue: pub.issue || null,
    pages: pub.pages || null,
    publisher: pub.publisher || null,
    type: "article",
    issn: pub.issn?.[0] || null,
    is_oa: isOA,
    // Dimensions-specific
    concepts: (pub.concepts || []).map((c) => c.concept || c).filter(Boolean),
  };
}

// ── bioRxiv / medRxiv ─────────────────────────────────────────────────────────

export function fromBiorxiv(paper, server = "biorxiv") {
  const doi = paper.doi || null;
  const arxiv_id = null;
  const authors = typeof paper.authors === "string"
    ? paper.authors.split(";").map((a) => a.trim()).filter(Boolean).slice(0, 6)
    : (Array.isArray(paper.authors) ? paper.authors.slice(0, 6) : []);
  const year = paper.date ? parseInt(paper.date.slice(0, 4), 10) || null : null;
  const pdf_url = doi ? `https://www.${server}.org/content/${doi}.full.pdf` : null;
  const url = doi ? `https://www.${server}.org/content/${doi}` : null;
  return {
    id: doi ? `doi:${doi}` : `${server}:${paper.rel_doi || paper.biorxiv_doi || "unknown"}`,
    title: paper.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id,
    abstract: paper.abstract || null,
    citation_count: null, // bioRxiv doesn't provide citation counts
    pdf_url,
    url,
    source: server,
    venue: server === "medrxiv" ? "medRxiv" : "bioRxiv",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: server === "medrxiv" ? "Cold Spring Harbor Laboratory Press" : "Cold Spring Harbor Laboratory",
    type: "preprint",
    issn: null,
    is_oa: true, // all bioRxiv/medRxiv are OA
    // bioRxiv-specific
    category: paper.category || null,
    version: paper.version || null,
  };
}

// ── Web of Science ────────────────────────────────────────────────────────────

export function fromWebOfScience(record) {
  const doi = record.identifiers?.doi || null;
  const authors = (record.names?.authors || [])
    .slice(0, 6)
    .map((a) => {
      const display = a.displayName || a.wosStandard || null;
      if (display) return display;
      const parts = [a.firstName, a.lastName].filter(Boolean);
      return parts.join(" ") || null;
    })
    .filter(Boolean);

  const year = record.source?.publishYear
    ? parseInt(record.source.publishYear, 10)
    : null;

  const journal = record.source?.sourceTitle || null;
  const citations = record.citations?.[0]?.count ?? null;

  return {
    id: doi ? `doi:${doi}` : `wos:${record.uid || "unknown"}`,
    title: record.title?.value || record.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: record.abstract?.value || null,
    citation_count: citations,
    pdf_url: null,
    url: doi ? `https://doi.org/${doi}` : null,
    source: "web_of_science",
    venue: journal,
    tldr: null,
    volume: record.source?.volume || null,
    issue: record.source?.issue || null,
    pages: record.source?.pages?.range || null,
    publisher: null,
    type: (record.documentType || "").toLowerCase().includes("review") ? "review" : "article",
    issn: record.source?.issn?.[0] || null,
    is_oa: Boolean(record.openAccess?.isOa),
    // WoS-specific
    wos_uid: record.uid || null,
    impact_factor: record.journalImpactFactor || null,
  };
}

// ── Zenodo ───────────────────────────────────────────────────────────────────

export function fromZenodo(record) {
  const meta = record.metadata || record;
  const doi = meta.doi || record.doi || null;
  const authors = (meta.creators || []).slice(0, 6).map((a) =>
    a.name || [a.given, a.family].filter(Boolean).join(" ") || null
  ).filter(Boolean);
  const year = meta.publication_date
    ? parseInt(meta.publication_date.slice(0, 4), 10) || null
    : null;
  const files = record.files || meta.files || [];
  const pdfFile = files.find((f) => (f.type || f.key || "").toLowerCase().includes("pdf"));
  const pdf_url = pdfFile?.links?.self || pdfFile?.key
    ? `https://zenodo.org/records/${record.id}/files/${pdfFile.key}`
    : null;
  return {
    id: doi ? `doi:${doi}` : `zenodo:${record.id || "unknown"}`,
    title: meta.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: meta.description?.replace(/<[^>]+>/g, "") || null,
    citation_count: null,
    pdf_url,
    url: record.links?.html || (record.id ? `https://zenodo.org/records/${record.id}` : null),
    source: "zenodo",
    venue: meta.journal?.title || meta.conference?.title || "Zenodo",
    tldr: null,
    volume: meta.journal?.volume || null,
    issue: meta.journal?.issue || null,
    pages: meta.journal?.pages || null,
    publisher: "CERN / Zenodo",
    type: meta.resource_type?.type || "publication",
    issn: null,
    is_oa: true,
    license: meta.license?.id || null,
  };
}

// ── HAL ───────────────────────────────────────────────────────────────────────

export function fromHal(doc) {
  const doi = doc.doiId_s || null;
  const authors = (doc.authFullName_s || []).slice(0, 6);
  const year = doc.producedDateY_i || doc.publicationDateY_i || null;
  const pdf_url = doc.fileMain_s || null;
  return {
    id: doi ? `doi:${doi}` : `hal:${doc.docid || "unknown"}`,
    title: Array.isArray(doc.title_s) ? doc.title_s[0] : doc.title_s || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: Array.isArray(doc.abstract_s) ? doc.abstract_s[0] : doc.abstract_s || null,
    citation_count: null,
    pdf_url,
    url: doc.uri_s || doc.linkExtUrl_s || null,
    source: "hal",
    venue: doc.journalTitle_s || "HAL",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    type: "article",
    issn: null,
    is_oa: true,
  };
}

// ── ChemRxiv ─────────────────────────────────────────────────────────────────

export function fromChemrxiv(item) {
  const doi = item.doi || null;
  const authors = (item.authors || []).slice(0, 6).map((a) =>
    a.name || [a.firstName, a.lastName].filter(Boolean).join(" ") || null
  ).filter(Boolean);
  const year = item.publishedDate
    ? parseInt(item.publishedDate.slice(0, 4), 10) || null
    : null;
  const pdf_url = item.asset?.original?.url || null;
  return {
    id: doi ? `doi:${doi}` : `chemrxiv:${item.id || "unknown"}`,
    title: item.title || "(untitled)",
    authors,
    year,
    doi,
    arxiv_id: null,
    abstract: item.abstract || null,
    citation_count: null,
    pdf_url,
    url: doi ? `https://doi.org/${doi}` : null,
    source: "chemrxiv",
    venue: "ChemRxiv",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: "American Chemical Society / ChemRxiv",
    type: "preprint",
    issn: null,
    is_oa: true,
    subject: item.subjectAreas?.[0]?.name || null,
  };
}

// ── Dedup + Rank (Reciprocal Rank Fusion) ────────────────────────────────────

/**
 * Deduplicate and rank papers from multiple sources using Reciprocal Rank Fusion.
 * RRF score: Σ_source [ 1 / (k + rank_in_source) ] where k=60 (standard constant).
 * Papers appearing in multiple sources are naturally boosted.
 * Citation count is used as a secondary signal via log-normalized bonus.
 *
 * @param {Array<Array<import('./formatter.js').AcademicPaper>>} lists - One list per source
 * @returns {import('./formatter.js').AcademicPaper[]}
 */
export function deduplicateAndRank(lists) {
  const RRF_K = 60;
  const seen = new Map();   // canonicalKey → AcademicPaper (merged)
  const scores = new Map(); // canonicalKey → accumulated RRF score
  const byTitle = new Map();// normalised title → canonicalKey

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const paper = list[rank];
      let key = _canonicalKey(paper);

      // Sources that scrape rather than index (SearXNG, some OJS portals) hand
      // back a record with no DOI, so the identifier-based key can never match
      // the same paper from OpenAlex and it appears twice. Fall back to the
      // title — but only when one of the two records lacks a DOI, so two
      // genuinely distinct DOIs are never collapsed into one.
      const titleKey = _titleKey(paper);
      if (titleKey) {
        const linked = byTitle.get(titleKey);
        if (linked && linked !== key) {
          const other = seen.get(linked);
          if (!paper.doi || !other?.doi) key = linked;
        }
        if (!byTitle.has(titleKey) || !paper.doi) byTitle.set(titleKey, key);
      }

      // Merge paper data (richer fields win)
      if (!seen.has(key)) {
        seen.set(key, paper);
      } else {
        seen.set(key, _mergePapers(seen.get(key), paper));
      }

      // Accumulate RRF score
      const rrfContrib = 1 / (RRF_K + rank + 1);
      scores.set(key, (scores.get(key) ?? 0) + rrfContrib);
    }
  }

  // Build result list sorted by RRF score desc, with citation bonus
  const maxCitations = Math.max(
    1,
    ...[...seen.values()].map((p) => p.citation_count ?? 0)
  );

  return [...seen.entries()]
    .map(([key, paper]) => {
      const rrfScore = scores.get(key) ?? 0;
      // Logarithmic citation bonus (max +0.05 contribution)
      const citBonus = paper.citation_count != null
        ? 0.05 * Math.log1p(paper.citation_count) / Math.log1p(maxCitations)
        : 0;
      return { paper, score: rrfScore + citBonus };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ paper }) => paper);
}

/**
 * Normalised title used to recognise the same paper across sources that do not
 * supply identifiers. Returns null for titles too short or too generic to be a
 * safe match.
 *
 * @param {Object} paper
 * @returns {string|null}
 */
function _titleKey(paper) {
  const t = String(paper?.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u1ef9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 16 || t === "untitled") return null;
  return `title:${t}`;
}

/** Counter behind the last-resort key for records that carry no identifier. */
let _anonKeySeq = 0;

function _canonicalKey(paper) {
  if (paper?.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper?.arxiv_id) return `arxiv:${paper.arxiv_id}`;
  if (paper?.id) return String(paper.id);

  // A record with no DOI, no arXiv id and no id at all used to fall through as
  // `undefined`, so every such record from every source landed on the SAME Map
  // key and all but one were silently thrown away. Fall back to the title when
  // it is distinctive enough to be a safe match, and otherwise to a key unique
  // to this record — two different papers must never merge into one.
  return _titleKey(paper) ?? `anon:${++_anonKeySeq}`;
}

function _mergePapers(a, b) {
  return {
    ...a,
    abstract: a.abstract || b.abstract,
    citation_count: a.citation_count ?? b.citation_count,
    pdf_url: a.pdf_url || b.pdf_url,
    url: a.url || b.url,
    venue: a.venue || b.venue,
    tldr: a.tldr || b.tldr,
    doi: a.doi || b.doi,
    arxiv_id: a.arxiv_id || b.arxiv_id,
    volume: a.volume || b.volume,
    issue: a.issue || b.issue,
    pages: a.pages || b.pages,
    publisher: a.publisher || b.publisher,
    issn: a.issn || b.issn,
    is_oa: a.is_oa || b.is_oa,
  };
}

// ── Format results ────────────────────────────────────────────────────────────

export function enrichPaperMetrics(p) {
  if (!p) return p;
  if (!p.quartile) {
    const qInfo = getJournalQuartile({ issn: p.issn, venue: p.venue });
    p.quartile = qInfo.quartile;
    p.journal_metrics = qInfo;
  }
  if (!p.takeaway) {
    p.takeaway = generateTakeaway(p);
  }
  return p;
}

export function formatConsensusBar(c) {
  if (!c || !c.has_consensus) return "";
  const blocksTotal = 20;
  const yesBlocks = Math.round((c.yes_pct / 100) * blocksTotal);
  const incBlocks = Math.round((c.inconclusive_pct / 100) * blocksTotal);
  const noBlocks = Math.max(0, blocksTotal - yesBlocks - incBlocks);
  const bar = "🟩".repeat(Math.max(0, yesBlocks)) +
              "🟨".repeat(Math.max(0, incBlocks)) +
              "🟥".repeat(Math.max(0, noBlocks));
  return [
    `### 🎯 Thước đo đồng thuận học thuật (Academic Consensus Meter)`,
    `**Kết luận**: ${c.verdict_label_vi} (*${c.verdict_label_en}*)`,
    `${bar}`,
    `* 🟩 **Ủng hộ (Yes)**: **${c.yes_pct}%** (${c.supporting_count} bài)`,
    `* 🟨 **Chưa ngã ngũ (Inconclusive)**: **${c.inconclusive_pct}%** (${c.inconclusive_count} bài)`,
    `* 🟥 **Bác bỏ / Không hiệu quả (No)**: **${c.no_pct}%** (${c.refuting_count} bài)`,
    `> 📋 **Tổng quan bằng chứng**: ${c.summary_vi}`,
    `*(Lượng hóa trọng số từ ${c.total_analyzed} nghiên cứu, gồm ${c.q1_count} bài Q1 và ${c.rct_count} bài RCT/Meta-analysis` +
      (c.excluded_no_results ? `; đã loại ${c.excluded_no_results} đề cương/đăng ký thử nghiệm/xã luận vì không báo cáo kết quả` : "") +
      `)*\n`,
    `---`
  ].join("\n");
}

export function formatResults(papers, total, consensus = null) {
  if (!papers.length) return "No results found.";
  const lines = [];

  if (consensus && consensus.has_consensus) {
    lines.push(formatConsensusBar(consensus));
    lines.push("");
  }

  lines.push(`Found ${papers.length} papers (total available: ~${total}):\n`);
  for (let i = 0; i < papers.length; i++) {
    const p = enrichPaperMetrics(papers[i]);
    const authorStr = p.authors.length
      ? p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : "")
      : "Unknown authors";
    const yearStr = p.year ? ` (${p.year})` : "";
    const citStr = p.citation_count != null ? ` · ${p.citation_count} citations` : "";
    const oaTag = p.is_oa ? " 🔓" : "";

    let stanceBadge = "";
    if (p.stance?.type === "yes") stanceBadge = " `[✓ Ủng hộ / Yes]`";
    else if (p.stance?.type === "no") stanceBadge = " `[✕ Bác bỏ / No]`";
    else if (p.stance?.type === "inconclusive") stanceBadge = " `[~ Chưa rõ / Inconclusive]`";

    lines.push(`## ${i + 1}. ${p.title}${stanceBadge}`);
    lines.push(`**Authors**: ${authorStr}${yearStr}${citStr}${oaTag}`);
    if (p.venue) {
      let v = `**Venue**: ${p.venue}`;
      if (p.quartile) {
        v += ` **[${p.quartile}]**`;
        if (p.journal_metrics?.sjr) v += ` (SJR ${p.journal_metrics.sjr})`;
      }
      if (p.volume) v += `, Vol. ${p.volume}`;
      if (p.issue) v += `(${p.issue})`;
      if (p.pages) v += `, pp. ${p.pages}`;
      lines.push(v);
    }
    if (p.issn) lines.push(`**ISSN**: ${p.issn}`);
    if (p.doi) lines.push(`**DOI**: https://doi.org/${p.doi}`);
    if (p.arxiv_id) lines.push(`**arXiv**: https://arxiv.org/abs/${p.arxiv_id}`);
    if (p.url && !p.doi && !p.arxiv_id) lines.push(`**URL**: ${p.url}`);
    if (p.pdf_url) lines.push(`**PDF**: ${p.pdf_url} ✅`);
    else if (p.institutional_url) lines.push(`**Truy cập VNU-HCM**: ${p.institutional_url} 🔑`);
    if (p.fulltext_url && p.fulltext_url !== p.pdf_url) lines.push(`**Toàn văn (thư viện)**: ${p.fulltext_url}`);
    if (p.takeaway) {
      lines.push(`> 💡 **Takeaway**: ${p.takeaway}`);
    } else if (p.tldr) {
      lines.push(`> 💡 **Takeaway**: ${p.tldr}`);
    }
    if (p.abstract) {
      const abs = p.abstract.length > 400 ? p.abstract.slice(0, 400) + "…" : p.abstract;
      lines.push(`**Abstract**: ${abs}`);
    }
    lines.push(`**Source**: ${p.source}${p.type && p.type !== "article" ? ` (${p.type})` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatConsensusReport(consensus, papers, query) {
  if (!consensus || !consensus.has_consensus) {
    return `### Không có đủ dữ liệu để lượng hóa đồng thuận cho câu hỏi: "${query}"`;
  }

  const lines = [
    `# BÁO CÁO LƯỢNG HÓA MỨC ĐỘ ĐỒNG THUẬN HỌC THUẬT`,
    `**Câu hỏi nghiên cứu**: *${query}*\n`,
    formatConsensusBar(consensus),
    `\n## Danh Sách Bằng Chứng Tiêu Biểu Theo Lập Trường:\n`
  ];

  const supporting = papers.filter(p => p.stance?.type === "yes");
  const refuting = papers.filter(p => p.stance?.type === "no");
  const inconclusive = papers.filter(p => p.stance?.type === "inconclusive");

  if (supporting.length > 0) {
    lines.push(`### 🟩 Nhóm Nghiên Cứu Ủng Hộ (Yes - ${supporting.length} bài)`);
    supporting.slice(0, 5).forEach((p, idx) => {
      lines.push(`${idx + 1}. **${p.title}** (${p.year || "N/A"}) — *${p.venue || p.source}* **[${p.quartile || "N/A"}]**`);
      if (p.takeaway) lines.push(`   > 💡 ${p.takeaway}`);
      if (p.doi) lines.push(`   Link: https://doi.org/${p.doi}`);
    });
    lines.push("");
  }

  if (refuting.length > 0) {
    lines.push(`### 🟥 Nhóm Nghiên Cứu Bác Bỏ / Không Hiệu Quả (No - ${refuting.length} bài)`);
    refuting.slice(0, 5).forEach((p, idx) => {
      lines.push(`${idx + 1}. **${p.title}** (${p.year || "N/A"}) — *${p.venue || p.source}* **[${p.quartile || "N/A"}]**`);
      if (p.takeaway) lines.push(`   > ⚠️ ${p.takeaway}`);
      if (p.doi) lines.push(`   Link: https://doi.org/${p.doi}`);
    });
    lines.push("");
  }

  if (inconclusive.length > 0) {
    lines.push(`### 🟨 Nhóm Nghiên Cứu Chưa Ngã Ngũ / Hỗn Hợp (Inconclusive - ${inconclusive.length} bài)`);
    inconclusive.slice(0, 3).forEach((p, idx) => {
      lines.push(`${idx + 1}. **${p.title}** (${p.year || "N/A"}) — *${p.venue || p.source}*`);
      if (p.takeaway) lines.push(`   > 💬 ${p.takeaway}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}


// ── Citation formatting ───────────────────────────────────────────────────────

/**
 * Format a paper into a standard citation string.
 * @param {AcademicPaper} paper
 * @param {"apa"|"ieee"|"bibtex"|"vancouver"|"mla"} style
 * @param {number} [index=1]  - Reference number for IEEE/Vancouver
 * @returns {string}
 */
export function formatCitation(paper, style = "apa", index = 1) {
  const authors = paper.authors || [];
  const year = paper.year || "n.d.";
  const title = paper.title || "(untitled)";
  const venue = paper.venue || "";
  const volume = paper.volume || "";
  const issue = paper.issue || "";
  const pages = paper.pages || "";
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : (paper.url || "");

  switch (style) {
    case "apa": {
      const a = _fmtAPA(authors);
      let c = `${a} (${year}). ${title}.`;
      if (venue) c += ` *${venue}*`;
      if (volume) c += `, *${volume}*`;
      if (issue) c += `(${issue})`;
      if (pages) c += `, ${pages}`;
      c += ".";
      if (doiUrl) c += ` ${doiUrl}`;
      return c;
    }
    case "ieee": {
      const a = _fmtIEEE(authors);
      let c = `[${index}] ${a}, "${title},"`;
      if (venue) c += ` *${venue}*,`;
      if (volume) c += ` vol. ${volume},`;
      if (issue) c += ` no. ${issue},`;
      if (pages) c += ` pp. ${pages},`;
      c += ` ${year}.`;
      if (paper.doi) c += ` doi: ${paper.doi}.`;
      return c;
    }
    case "bibtex": {
      const key = _bibKey(paper);
      const aBib = authors.join(" and ") || "Unknown";
      const et = paper.type === "conference" ? "inproceedings" : paper.type === "preprint" ? "misc" : paper.type === "book_chapter" ? "incollection" : paper.type === "book" ? "book" : paper.type === "dissertation" ? "phdthesis" : paper.type === "policy_report" ? "techreport" : paper.type === "dataset" || paper.type === "software" ? "misc" : paper.type === "clinical_trial" || paper.type === "protocol" ? "techreport" : "article";
      const vf = paper.type === "conference" ? "booktitle" : "journal";
      let b = `@${et}{${key},\n`;
      b += `  author    = {${aBib}},\n`;
      b += `  title     = {{${title}}},\n`;
      if (venue) b += `  ${vf}   = {${venue}},\n`;
      b += `  year      = {${paper.year || ""}},\n`;
      if (volume) b += `  volume    = {${volume}},\n`;
      if (issue) b += `  number    = {${issue}},\n`;
      if (pages) b += `  pages     = {${pages}},\n`;
      if (paper.publisher) b += `  publisher = {${paper.publisher}},\n`;
      if (paper.issn) b += `  issn      = {${paper.issn}},\n`;
      if (paper.doi) b += `  doi       = {${paper.doi}},\n`;
      if (paper.url && !paper.doi) b += `  url       = {${paper.url}},\n`;
      b += `}`;
      return b;
    }
    case "vancouver": {
      const a = _fmtVancouver(authors);
      let c = `${index}. ${a}. ${title}.`;
      if (venue) c += ` ${venue}.`;
      if (year !== "n.d.") {
        c += ` ${year}`;
        if (volume) c += `;${volume}`;
        if (issue) c += `(${issue})`;
        if (pages) c += `:${pages}`;
        c += ".";
      }
      if (paper.doi) c += ` doi: ${paper.doi}.`;
      return c;
    }
    case "mla": {
      const a = _fmtMLA(authors);
      let c = `${a}. "${title}."`;
      if (venue) c += ` *${venue}*,`;
      if (volume) c += ` vol. ${volume},`;
      if (issue) c += ` no. ${issue},`;
      if (year !== "n.d.") c += ` ${year}`;
      if (pages) c += `, pp. ${pages}`;
      c += ".";
      if (doiUrl) c += ` ${doiUrl}.`;
      return c;
    }
    case "ris": {
      const type = paper.type === "conference" ? "CONF" : paper.type === "book_chapter" ? "CHAP" : paper.type === "book" ? "BOOK" : paper.type === "dissertation" ? "THES" : paper.type === "dataset" ? "DATA" : paper.type === "preprint" || paper.type === "policy_report" || paper.type === "clinical_trial" || paper.type === "protocol" ? "RPRT" : "JOUR";
      let r = `TY  - ${type}\n`;
      r += `TI  - ${title}\n`;
      for (const auth of authors) {
        r += `AU  - ${auth}\n`;
      }
      if (venue) r += `JO  - ${venue}\n`;
      if (paper.year) r += `PY  - ${paper.year}\n`;
      if (volume) r += `VL  - ${volume}\n`;
      if (issue) r += `IS  - ${issue}\n`;
      if (pages) {
        const parts = pages.split("-");
        if (parts[0]) r += `SP  - ${parts[0]}\n`;
        if (parts[1]) r += `EP  - ${parts[1]}\n`;
      }
      if (paper.doi) r += `DO  - ${paper.doi}\n`;
      if (paper.url) r += `UR  - ${paper.url}\n`;
      if (paper.pdf_url) r += `L1  - ${paper.pdf_url}\n`;
      if (paper.abstract) r += `AB  - ${paper.abstract.replace(/\n+/g, " ")}\n`;
      if (paper.publisher) r += `PB  - ${paper.publisher}\n`;
      if (paper.issn) r += `SN  - ${paper.issn}\n`;
      r += `ER  - \n`;
      return r;
    }
    case "csl_json":
    case "csl":
    case "zotero": {
      const type = paper.type === "conference" ? "paper-conference" : paper.type === "book_chapter" ? "chapter" : paper.type === "book" ? "book" : paper.type === "dissertation" ? "thesis" : paper.type === "dataset" ? "dataset" : paper.type === "policy_report" || paper.type === "clinical_trial" || paper.type === "protocol" ? "report" : "article-journal";
      const cslAuthors = authors.map((name) => {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return { literal: name };
        return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
      });
      const cslObj = {
        id: paper.id || _bibKey(paper),
        type,
        title,
        author: cslAuthors,
        "container-title": venue || undefined,
        issued: paper.year ? { "date-parts": [[paper.year]] } : undefined,
        volume: volume || undefined,
        issue: issue || undefined,
        page: pages || undefined,
        DOI: paper.doi || undefined,
        URL: paper.url || undefined,
        abstract: paper.abstract || undefined,
        publisher: paper.publisher || undefined,
        ISSN: paper.issn || undefined,
      };
      return JSON.stringify(cslObj, null, 2);
    }
    default:
      throw new Error(`Unknown citation style: "${style}". Supported: apa, ieee, bibtex, vancouver, mla, ris, csl_json, zotero`);
  }
}

// ── Citation helpers ──────────────────────────────────────────────────────────

function _fmtAPA(authors) {
  if (!authors.length) return "(Unknown Author)";
  const f = (n) => { const p = n.trim().split(/\s+/); if (p.length === 1) return p[0]; const last = p[p.length - 1]; return `${last}, ${p.slice(0, -1).map((x) => x[0] + ".").join(" ")}`; };
  if (authors.length === 1) return f(authors[0]);
  if (authors.length <= 7) return authors.slice(0, -1).map(f).join(", ") + ", & " + f(authors[authors.length - 1]);
  return authors.slice(0, 6).map(f).join(", ") + ", . . . " + f(authors[authors.length - 1]);
}

function _fmtIEEE(authors) {
  if (!authors.length) return "Unknown";
  const f = (n) => { const p = n.trim().split(/\s+/); if (p.length === 1) return p[0]; const last = p[p.length - 1]; return `${p.slice(0, -1).map((x) => x[0] + ".").join(" ")} ${last}`; };
  const all = authors.slice(0, 6).map(f);
  if (authors.length > 6) all.push("et al.");
  if (all.length === 1) return all[0];
  if (all.length === 2) return all.join(" and ");
  return all.slice(0, -1).join(", ") + " and " + all[all.length - 1];
}

function _fmtVancouver(authors) {
  if (!authors.length) return "";
  const f = (n) => { const p = n.trim().split(/\s+/); if (p.length === 1) return p[0]; return `${p[p.length - 1]} ${p.slice(0, -1).map((x) => x[0]).join("")}`; };
  const fmt = authors.slice(0, 6).map(f);
  if (authors.length > 6) return fmt.join(", ") + ", et al.";
  return fmt.join(", ");
}

function _fmtMLA(authors) {
  if (!authors.length) return "(Unknown Author)";
  const p = authors[0].trim().split(/\s+/);
  const first = p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : p[0];
  if (authors.length === 1) return first;
  if (authors.length === 2) return `${first}, and ${authors[1]}`;
  return `${first}, et al.`;
}

function _bibKey(paper) {
  const last = (paper.authors?.[0] || "Unknown").trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") || "unknown";
  const y = paper.year || "xxxx";
  const w = (paper.title || "").split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "") || "paper";
  return `${last}${y}${w}`;
}

export function fromHuggingFace(item) {
  const p = item.paper || item;
  const arxivId = p.id || null;
  const authors = (p.authors || []).map((a) => (typeof a === "object" ? a.name || a.hiddenName : a)).filter(Boolean);
  return {
    id: arxivId ? `arxiv:${arxivId}` : `huggingface:${p.id || Math.random()}`,
    title: p.title || "(untitled)",
    authors: authors.length ? authors : ["Hugging Face Community"],
    year: p.publishedAt ? parseInt(p.publishedAt.slice(0, 4), 10) : new Date().getFullYear(),
    doi: null,
    arxiv_id: arxivId,
    abstract: p.summary || null,
    citation_count: item.upvotes || p.upvotes || 0,
    pdf_url: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null,
    url: arxivId ? `https://huggingface.co/papers/${arxivId}` : "https://huggingface.co/papers",
    source: "huggingface",
    venue: "Hugging Face Daily Papers",
    tldr: p.summary ? p.summary.slice(0, 200) + "..." : null,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Hugging Face",
    type: "preprint",
    issn: null,
    is_oa: true,
  };
}

export function fromOpenReview(note) {
  const content = note.content || {};
  const title = content.title?.value || content.title || "(untitled)";
  const authors = content.authors?.value || content.authors || [];
  const abstract = content.abstract?.value || content.abstract || null;
  const venue = note.invitation || content.venue?.value || "OpenReview";
  const pdfUrl = note.pdf ? `https://openreview.net${note.pdf}` : null;
  const year = note.cdate ? new Date(note.cdate).getFullYear() : (note.tcdate ? new Date(note.tcdate).getFullYear() : null);
  return {
    id: `openreview:${note.id}`,
    title,
    authors: Array.isArray(authors) ? authors : [authors],
    year,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: pdfUrl,
    url: `https://openreview.net/forum?id=${note.id}`,
    source: "openreview",
    venue: typeof venue === "string" ? venue : "OpenReview",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: "OpenReview",
    type: "conference",
    issn: null,
    is_oa: true,
  };
}

export function fromSearXNG(item) {
  const url = item.url || "";
  const title = (item.title || "(untitled)").replace(/\s*[-–—|]\s*(MDPI|SpringerLink|ScienceDirect|IEEE Xplore|Nature|Wiley Online Library|ResearchGate|ACM Digital Library|PubMed|arXiv)\s*$/i, "").trim();

  // Extract DOI from URL
  let doi = null;
  const doiMatch = url.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
  if (doiMatch) {
    doi = doiMatch[0].replace(/[#?].*$/, "").replace(/\.pdf$/i, "");
  }

  // Extract arXiv ID (handles /abs/, /pdf/, /html/)
  let arxivId = null;
  const arxivMatch = url.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (arxivMatch) {
    arxivId = arxivMatch[1].replace(/v\d+$/, "");
  }

  // Extract Year
  let year = null;
  if (item.published_at) {
    const y = parseInt(item.published_at.slice(0, 4), 10);
    if (!isNaN(y) && y > 1900 && y <= new Date().getFullYear() + 1) year = y;
  }
  if (!year) {
    const yearMatch = (item.snippet || "").match(/\b(19\d\d|20[0-2]\d)\b/);
    if (yearMatch) year = parseInt(yearMatch[1], 10);
  }

  // Determine Venue & Publisher from Domain
  let venue = item.display_url || null;
  let publisher = null;
  let isRepo = false;
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    if (host.includes("mdpi.com")) { venue = "MDPI"; publisher = "MDPI"; }
    else if (host.includes("springer.com") || host.includes("nature.com")) { venue = "Springer Nature"; publisher = "Springer Nature"; }
    else if (host.includes("sciencedirect.com") || host.includes("elsevier.com")) { venue = "Elsevier / ScienceDirect"; publisher = "Elsevier"; }
    else if (host.includes("ieee.org")) { venue = "IEEE Xplore"; publisher = "IEEE"; }
    else if (host.includes("acm.org")) { venue = "ACM Digital Library"; publisher = "ACM"; }
    else if (host.includes("wiley.com")) { venue = "Wiley Online Library"; publisher = "Wiley"; }
    else if (host.includes("frontiersin.org")) { venue = "Frontiers"; publisher = "Frontiers"; }
    else if (host.includes("arxiv.org")) { venue = "arXiv.org"; publisher = "Cornell University"; }
    else if (host.includes("github.com")) { venue = "GitHub Repository"; publisher = "GitHub"; isRepo = true; }
    else { venue = host.replace(/^www\./, ""); }
  } catch {
    // fallback
  }

  const isPdf = url.toLowerCase().endsWith(".pdf");
  const pdfUrl = isPdf ? url : (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null);

  const hashKey = Buffer.from(url).toString("base64url").slice(0, 24);

  return {
    id: doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId}` : `searxng:${hashKey}`,
    title,
    authors: isRepo ? ["Open Source Repository"] : [],
    year,
    doi,
    arxiv_id: arxivId,
    abstract: item.snippet || null,
    citation_count: null,
    pdf_url: pdfUrl,
    url,
    source: "searxng",
    venue,
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher,
    type: arxivId ? "preprint" : isRepo ? "software" : "article",
    issn: null,
    is_oa: Boolean(isPdf || arxivId || isRepo),
  };
}

// ── Perplexity AI Search ───────────────────────────────────────────────────────

export function fromPerplexity(item) {
  const url = item.url || "";
  const title = (item.title || "(untitled)").replace(/\s*[-–—|]\s*(MDPI|SpringerLink|ScienceDirect|IEEE Xplore|Nature|Wiley Online Library|ResearchGate|ACM Digital Library|PubMed|arXiv|VJOL)\s*$/i, "").trim();

  let doi = item.doi || null;
  if (!doi && url) {
    const doiMatch = url.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
    if (doiMatch) {
      doi = doiMatch[0].replace(/[#?].*$/, "").replace(/\.pdf$/i, "");
    }
  }

  let arxivId = item.arxiv_id || null;
  if (!arxivId && url) {
    const arxivMatch = url.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivMatch) {
      arxivId = arxivMatch[1].replace(/v\d+$/, "");
    }
  }

  let year = item.year || null;
  if (!year && item.date) {
    const y = parseInt(String(item.date).slice(0, 4), 10);
    if (!isNaN(y) && y > 1900 && y <= new Date().getFullYear() + 1) year = y;
  }
  if (!year) {
    const yearMatch = (item.snippet || item.abstract || "").match(/\b(19\d\d|20[0-2]\d)\b/);
    if (yearMatch) year = parseInt(yearMatch[1], 10);
  }

  let venue = item.venue || null;
  let publisher = item.publisher || null;
  if (!venue && url) {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.toLowerCase();
      if (host.includes("mdpi.com")) { venue = "MDPI"; publisher = "MDPI"; }
      else if (host.includes("springer.com") || host.includes("nature.com")) { venue = "Springer Nature"; publisher = "Springer Nature"; }
      else if (host.includes("sciencedirect.com") || host.includes("elsevier.com")) { venue = "Elsevier / ScienceDirect"; publisher = "Elsevier"; }
      else if (host.includes("ieee.org")) { venue = "IEEE Xplore"; publisher = "IEEE"; }
      else if (host.includes("acm.org")) { venue = "ACM Digital Library"; publisher = "ACM"; }
      else if (host.includes("wiley.com")) { venue = "Wiley Online Library"; publisher = "Wiley"; }
      else if (host.includes("frontiersin.org")) { venue = "Frontiers"; publisher = "Frontiers"; }
      else if (host.includes("arxiv.org")) { venue = "arXiv.org"; publisher = "Cornell University"; }
      else if (host.includes("vjol.info.vn")) { venue = "Tạp chí Khoa học Việt Nam Trực tuyến (VJOL)"; publisher = "VJOL"; }
      else if (host.includes("tapchiyhoctphcm.vn")) { venue = "Tạp chí Y học TP.HCM"; publisher = "ĐH Y Dược TP.HCM"; }
      else if (host.includes("sti.vista.gov.vn")) { venue = "Cơ sở dữ liệu VISTA (NASATI)"; publisher = "NASATI"; }
      else { venue = host.replace(/^www\./, ""); }
    } catch {}
  }

  const isPdf = url.toLowerCase().endsWith(".pdf") || Boolean(item.pdf_url);
  const pdfUrl = item.pdf_url || (isPdf ? url : (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null));

  const authors = Array.isArray(item.authors) ? item.authors : (typeof item.authors === "string" ? [item.authors] : []);
  const hashKey = Buffer.from(url || title).toString("base64url").slice(0, 24);

  return {
    id: doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId}` : `perplexity:${hashKey}`,
    title,
    authors: authors.length > 0 ? authors : ["Perplexity Discovery"],
    year,
    doi,
    arxiv_id: arxivId,
    abstract: item.abstract || item.snippet || null,
    citation_count: item.citation_count ?? null,
    pdf_url: pdfUrl,
    url: url || (doi ? `https://doi.org/${doi}` : null),
    source: "perplexity",
    venue: venue || "Perplexity AI Web Grounding",
    tldr: null,
    volume: null,
    issue: null,
    pages: null,
    publisher,
    type: arxivId ? "preprint" : "article",
    issn: null,
    is_oa: Boolean(isPdf || arxivId || item.is_oa),
  };
}

// ── ClinicalTrials.gov ─────────────────────────────────────────────────────────

export function fromClinicalTrials(study) {
  const protocol = study.protocolSection || {};
  const ident = protocol.identificationModule || {};
  const nctId = ident.nctId || "NCT00000000";
  const title = ident.briefTitle || ident.officialTitle || "(untitled study)";

  const sponsors = protocol.sponsorCollaboratorsModule || {};
  const leadSponsor = sponsors.leadSponsor?.name;
  const authors = leadSponsor ? [leadSponsor] : ["ClinicalTrials.gov Investigator"];

  const statusMod = protocol.statusModule || {};
  const startDateStr = statusMod.startDateStruct?.date || "";
  const year = startDateStr ? parseInt(startDateStr.slice(0, 4), 10) || null : null;

  const descMod = protocol.descriptionModule || {};
  const abstract = descMod.briefSummary || descMod.detailedDescription || null;

  const design = protocol.designModule || {};
  const phases = design.phases ? design.phases.join(", ") : "Not Applicable";
  const status = statusMod.overallStatus || "Unknown";

  const conditions = (protocol.conditionsModule?.conditions || []).slice(0, 5).join("; ");
  const interventions = (protocol.armsInterventionsModule?.interventions || [])
    .map((i) => `${i.type}: ${i.name}`)
    .slice(0, 5)
    .join("; ");

  const detailedAbstract = [
    `Status: ${status} | Phase: ${phases}`,
    conditions ? `Conditions: ${conditions}` : null,
    interventions ? `Interventions: ${interventions}` : null,
    abstract ? `Summary: ${abstract}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `nct:${nctId}`,
    title: `[Clinical Trial ${nctId}] ${title}`,
    authors,
    year,
    doi: null,
    arxiv_id: null,
    abstract: detailedAbstract,
    citation_count: null,
    pdf_url: null,
    url: `https://clinicaltrials.gov/study/${nctId}`,
    source: "clinicaltrials",
    venue: `ClinicalTrials.gov (${phases})`,
    tldr: `Status: ${status} (${phases}) - ${title}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "U.S. National Library of Medicine (NLM)",
    type: "clinical_trial",
    issn: null,
    is_oa: true,
  };
}

// ── OpenFDA ───────────────────────────────────────────────────────────────────

export function fromOpenFda(drug) {
  const openfda = drug.openfda || {};
  const brandName = openfda.brand_name?.[0] || "";
  const genericName = openfda.generic_name?.[0] || "";
  const title = brandName
    ? `${brandName}${genericName ? ` (${genericName})` : ""} - FDA Drug Monograph`
    : (genericName ? `${genericName} - FDA Drug Monograph` : "FDA Approved Drug Monograph");

  const manufacturers = openfda.manufacturer_name || ["U.S. Food and Drug Administration (FDA)"];
  const id = openfda.spl_id?.[0] || drug.id || drug.set_id || "fda_drug";

  const indications = Array.isArray(drug.indications_and_usage)
    ? drug.indications_and_usage[0]
    : drug.indications_and_usage;
  const warnings = Array.isArray(drug.warnings)
    ? drug.warnings[0]
    : (Array.isArray(drug.warnings_and_cautions) ? drug.warnings_and_cautions[0] : null);
  const dosage = Array.isArray(drug.dosage_and_administration)
    ? drug.dosage_and_administration[0]
    : drug.dosage_and_administration;

  const sections = [
    indications ? `[Indications & Usage]\n${indications.slice(0, 1000)}` : null,
    warnings ? `[Warnings & Precautions]\n${warnings.slice(0, 1000)}` : null,
    dosage ? `[Dosage & Administration]\n${dosage.slice(0, 500)}` : null,
  ].filter(Boolean);

  const abstract = sections.join("\n\n") || "FDA Official Drug Information and Labeling Details.";

  return {
    id: `openfda:${id}`,
    title,
    authors: Array.isArray(manufacturers) ? manufacturers.slice(0, 5) : [manufacturers],
    year: openfda.effective_time ? parseInt(String(openfda.effective_time).slice(0, 4), 10) || null : null,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: openfda.spl_set_id?.[0]
      ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${openfda.spl_set_id[0]}`
      : "https://open.fda.gov",
    source: "openfda",
    venue: "U.S. FDA Drug Labeling & Knowledge Base",
    tldr: `${brandName || genericName}: FDA Approved Pharmaceutical Monograph`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "U.S. Food and Drug Administration",
    type: "guideline",
    issn: null,
    is_oa: true,
  };
}

// ── NIST NVD (CVE) ───────────────────────────────────────────────────────────

export function fromCveNvd(cveItem) {
  const cve = cveItem.cve || cveItem;
  const cveId = cve.id || "CVE-UNKNOWN";

  const englishDesc = (cve.descriptions || []).find((d) => d.lang === "en")?.value
    || cve.descriptions?.[0]?.value
    || "No description provided.";

  const title = `[${cveId}] ${englishDesc.slice(0, 120)}${englishDesc.length > 120 ? "..." : ""}`;
  const authors = [cve.sourceIdentifier || "NIST National Vulnerability Database"];

  const published = cve.published || "";
  const year = published ? parseInt(published.slice(0, 4), 10) || null : null;

  // Extract CVSS scores
  const metrics = cve.metrics || {};
  const cvssV31 = metrics.cvssMetricV31?.[0]?.cvssData;
  const cvssV30 = metrics.cvssMetricV30?.[0]?.cvssData;
  const cvssV2 = metrics.cvssMetricV2?.[0]?.cvssData;
  const cvss = cvssV31 || cvssV30 || cvssV2 || {};

  const score = cvss.baseScore ? `${cvss.baseScore} (${cvss.baseSeverity || "UNKNOWN"})` : "N/A";
  const vector = cvss.vectorString || "";

  const abstract = [
    `Vulnerability Description:\n${englishDesc}`,
    `CVSS Base Score: ${score}`,
    vector ? `CVSS Vector: ${vector}` : null,
    `Published Date: ${published}`,
  ].filter(Boolean).join("\n\n");

  return {
    id: `cve:${cveId}`,
    title,
    authors,
    year,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: `https://nvd.nist.gov/vuln/detail/${cveId}`,
    source: "cve_nvd",
    venue: `NIST NVD (CVSS ${score})`,
    tldr: `${cveId} - CVSS ${score}: ${englishDesc.slice(0, 100)}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "National Institute of Standards and Technology (NIST)",
    type: "security_advisory",
    issn: null,
    is_oa: true,
  };
}


export function fromCisaKev(item) {
  const cveId = item.cveID || "CVE-UNKNOWN";
  const title = `[CISA KEV] ${cveId} - ${item.vulnerabilityName || item.vendorProject || "Active Exploit"}`;
  const authors = [item.vendorProject || "CISA Cybersecurity and Infrastructure Security Agency"];

  const dateAdded = item.dateAdded || "";
  const year = dateAdded ? parseInt(dateAdded.slice(0, 4), 10) || null : null;

  const abstract = [
    `Description:\n${item.shortDescription || "Active in-the-wild exploitation confirmed."}`,
    `Vendor/Product: ${item.vendorProject} - ${item.product}`,
    `Required Action: ${item.requiredAction || "Apply mitigations per vendor instructions"}`,
    `Remediation Due Date: ${item.dueDate || "Immediate"}`,
    `Known Ransomware Campaign Use: ${item.knownRansomwareCampaignUse || "Unknown"}`,
    `Date Added to Catalog: ${dateAdded}`,
  ].join("\n\n");

  return {
    id: `cisa-kev:${cveId}`,
    title,
    authors,
    year,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
    source: "cisa_kev",
    venue: "CISA Known Exploited Vulnerabilities Catalog",
    tldr: `Actively Exploited: ${cveId} (${item.vendorProject} ${item.product}) - Due: ${item.dueDate}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Cybersecurity and Infrastructure Security Agency (CISA)",
    type: "security_advisory",
    issn: null,
    is_oa: true,
  };
}

// ── Google OSV ───────────────────────────────────────────────────────────────

export function fromOsv(vuln) {
  const vulnId = vuln.id || "OSV-UNKNOWN";
  const summary = vuln.summary || vuln.details?.slice(0, 120) || "Open Source Package Vulnerability";
  const title = `[OSV] ${vulnId}: ${summary}`;

  const published = vuln.published || "";
  const year = published ? parseInt(published.slice(0, 4), 10) || null : null;

  const affectedPkgs = (vuln.affected || [])
    .map((a) => `${a.package?.ecosystem || "Eco"}:${a.package?.name || "pkg"}`)
    .slice(0, 5)
    .join(", ");

  const abstract = [
    vuln.details || summary,
    affectedPkgs ? `Affected Ecosystem/Packages: ${affectedPkgs}` : null,
    `Published: ${published}`,
  ].filter(Boolean).join("\n\n");

  return {
    id: `osv:${vulnId}`,
    title,
    authors: ["Google Open Source Vulnerabilities (OSV.dev)"],
    year,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: `https://osv.dev/vulnerability/${vulnId}`,
    source: "osv",
    venue: `OSV.dev (${affectedPkgs || "Open Source"})`,
    tldr: `${vulnId}: ${summary.slice(0, 100)}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Open Source Security Foundation (OpenSSF) / Google",
    type: "security_advisory",
    issn: null,
    is_oa: true,
  };
}

// ── ACL Anthology ────────────────────────────────────────────────────────────

export function fromAclAnthology(work) {
  // Leverage base openalex or normalized academic shape with ACL venue tag
  const base = typeof work.display_name !== "undefined" ? fromOpenAlex(work) : work;
  return {
    ...base,
    source: "acl_anthology",
    venue: base.venue || "Association for Computational Linguistics (ACL)",
    publisher: "Association for Computational Linguistics",
    is_oa: true,
  };
}

// ── USPTO Patents ────────────────────────────────────────────────────────────

export function fromUsptoPatent(patent) {
  const patentNum = patent.patent_number || patent.patent_id || "US-PATENT";
  const title = patent.patent_title || "(untitled patent)";
  const inventors = (patent.inventors || []).map((i) => {
    const fn = i.inventor_first_name || "";
    const ln = i.inventor_last_name || "";
    return `${fn} ${ln}`.trim();
  }).filter(Boolean);

  const assignees = (patent.assignees || []).map((a) => a.assignee_organization).filter(Boolean);
  const authors = inventors.length > 0 ? inventors : (assignees.length > 0 ? assignees : ["USPTO Inventor"]);

  const dateStr = patent.patent_date || "";
  const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) || null : null;

  const abstract = [
    patent.patent_abstract ? `[Patent Abstract]\n${patent.patent_abstract}` : null,
    assignees.length > 0 ? `Assignee: ${assignees.join(", ")}` : null,
    `Grant Date: ${dateStr}`,
  ].filter(Boolean).join("\n\n");

  return {
    id: `patent:${patentNum}`,
    title: `[US Patent ${patentNum}] ${title}`,
    authors,
    year,
    doi: null,
    arxiv_id: null,
    abstract: abstract || "United States Granted Patent Document.",
    citation_count: null,
    pdf_url: `https://pdfpiw.uspto.gov/.piw?PageNum=0&docid=${patentNum}`,
    url: `https://patents.google.com/patent/US${patentNum}`,
    source: "uspto_patents",
    venue: `USPTO Patent Grant (${assignees[0] || "United States Patent"})`,
    tldr: `US Patent ${patentNum}: ${title}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "United States Patent and Trademark Office",
    type: "patent",
    issn: null,
    is_oa: true,
  };
}

// ── PubChem ──────────────────────────────────────────────────────────────────

export function fromPubChem(compound) {
  const cid = compound.cid || compound.id?.id?.cid || "0";
  const name = compound.name || compound.iupac_name || `PubChem CID ${cid}`;
  const formula = compound.molecular_formula || "";
  const weight = compound.molecular_weight ? `MW: ${compound.molecular_weight} g/mol` : "";
  const inchiKey = compound.inchikey || "";

  const title = `[PubChem CID ${cid}] ${name}${formula ? ` (${formula})` : ""}`;
  const authors = ["National Center for Biotechnology Information (NCBI PubChem)"];

  const abstract = [
    compound.description ? `Description:\n${compound.description}` : null,
    `Chemical Properties: ${[formula, weight, inchiKey ? `InChIKey: ${inchiKey}` : null].filter(Boolean).join(" | ")}`,
    compound.pharmacology ? `Pharmacology & Bioactivity:\n${compound.pharmacology}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `pubchem:${cid}`,
    title,
    authors,
    year: compound.modify_date ? parseInt(String(compound.modify_date).slice(0, 4), 10) : (compound.deposit_date ? parseInt(String(compound.deposit_date).slice(0, 4), 10) : null),
    doi: null,
    arxiv_id: null,
    abstract: abstract || "NIH PubChem Chemical Compound Record.",
    citation_count: null,
    pdf_url: null,
    url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    source: "pubchem",
    venue: `NCBI PubChem (${formula || "Chemical Compound"})`,
    tldr: `CID ${cid} - ${name} (${formula})`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "National Library of Medicine (NLM)",
    type: "chemical_compound",
    issn: null,
    is_oa: true,
  };
}

// ── UniProt ──────────────────────────────────────────────────────────────────

export function fromUniProt(entry) {
  const accession = entry.primaryAccession || entry.accession || "UNKNOWN";
  const recName = entry.proteinDescription?.recommendedName?.fullName?.value
    || entry.uniProtkbId
    || "Protein Entry";
  const geneName = entry.genes?.[0]?.geneName?.value || null;
  const organism = entry.organism?.scientificName || entry.organism?.commonName || "";

  const title = `[UniProt ${accession}] ${recName}${geneName ? ` (Gene: ${geneName})` : ""}${organism ? ` - ${organism}` : ""}`;
  const authors = ["UniProt Consortium (EMBL-EBI, SIB, PIR)"];

  const functionComment = (entry.comments || [])
    .filter((c) => c.commentType === "FUNCTION")
    .map((c) => c.texts?.[0]?.value)
    .filter(Boolean)
    .join("\n\n");

  const subCell = (entry.comments || [])
    .filter((c) => c.commentType === "SUBCELLULAR LOCATION")
    .map((c) => c.subcellularLocations?.[0]?.location?.value)
    .filter(Boolean)
    .join(", ");

  const abstract = [
    functionComment ? `Function:\n${functionComment}` : null,
    subCell ? `Subcellular Location: ${subCell}` : null,
    `Organism: ${organism} | Primary Accession: ${accession}`,
  ].filter(Boolean).join("\n\n");

  return {
    id: `uniprot:${accession}`,
    title,
    authors,
    year: entry.entryAudit?.lastAnnotationUpdateDate ? parseInt(String(entry.entryAudit.lastAnnotationUpdateDate).slice(0, 4), 10) : null,
    doi: null,
    arxiv_id: null,
    abstract: abstract || "Universal Protein Resource Knowledgebase Record.",
    citation_count: null,
    pdf_url: null,
    url: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
    source: "uniprot",
    venue: `UniProtKB (${organism || "Protein"})`,
    tldr: `UniProt ${accession}: ${recName} [${organism}]`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "UniProt Consortium",
    type: "protein_record",
    issn: null,
    is_oa: true,
  };
}

// ── RCSB PDB ─────────────────────────────────────────────────────────────────

export function fromPdb(entry) {
  const pdbId = entry.rcsb_id || entry.entry?.id || "PDB-0000";
  const title = entry.struct?.title || `[PDB ${pdbId}] Macromolecular Structure`;
  const authors = (entry.audit_author || []).map((a) => a.name).filter(Boolean).slice(0, 6);

  const method = entry.exptl?.[0]?.method || "Experimental Structure";
  const resolution = entry.rcsb_entry_info?.resolution_combined?.[0];
  const resStr = resolution ? `Resolution: ${resolution} Å` : "";

  const releaseDate = entry.rcsb_accession_info?.initial_release_date || "";
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) || null : null;

  const abstract = [
    `Title: ${title}`,
    `Experimental Method: ${method} ${resStr ? `(${resStr})` : ""}`,
    entry.struct_keywords?.pdbx_keywords ? `Keywords: ${entry.struct_keywords.pdbx_keywords}` : null,
    entry.rcsb_entry_container_identifiers?.polymer_entity_ids ? `Polymer Entities: ${entry.rcsb_entry_container_identifiers.polymer_entity_ids.length}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `pdb:${pdbId}`,
    title: `[PDB ${pdbId}] ${title}`,
    authors: authors.length > 0 ? authors : ["RCSB PDB Depositor"],
    year,
    doi: `10.2210/pdb${pdbId.toLowerCase()}/pdb`,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: `https://www.rcsb.org/structure/${pdbId}`,
    source: "rcsb_pdb",
    venue: `RCSB Protein Data Bank (${method})`,
    tldr: `PDB ${pdbId} (${method}): ${title.slice(0, 90)}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Worldwide Protein Data Bank (wwPDB)",
    type: "structure_3d",
    issn: null,
    is_oa: true,
  };
}

// ── NCBI ClinVar ─────────────────────────────────────────────────────────────

export function fromClinVar(variant) {
  const id = variant.id || variant.uid || "0";
  const title = variant.title || `[ClinVar ${id}] Genetic Variation`;
  const clinicalSignificance = variant.clinical_significance || variant.germline_classification || "Clinical Variant";
  const genes = variant.genes || [];
  const geneStr = genes.map((g) => g.symbol || g).join(", ");
  const condition = variant.trait_names?.join("; ") || variant.condition || "Clinical condition not specified";

  const abstract = [
    `Clinical Significance: ${clinicalSignificance}`,
    geneStr ? `Associated Gene(s): ${geneStr}` : null,
    `Phenotype / Conditions: ${condition}`,
    variant.variation_set?.[0]?.variation_name ? `Variant Name: ${variant.variation_set[0].variation_name}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `clinvar:${id}`,
    title: `[ClinVar ${id}] ${title}`,
    authors: ["NCBI ClinVar Database"],
    year: variant.last_evaluated ? parseInt(String(variant.last_evaluated).slice(0, 4), 10) : null,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`,
    source: "clinvar",
    venue: `NCBI ClinVar (${clinicalSignificance})`,
    tldr: `ClinVar ${id}: ${clinicalSignificance} [${geneStr || "Variant"}]`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "National Center for Biotechnology Information",
    type: "genetic_variant",
    issn: null,
    is_oa: true,
  };
}

// ── Hugging Face Datasets ────────────────────────────────────────────────────

export function fromHfDataset(dataset) {
  const id = dataset.id || dataset._id || "dataset";
  const title = `[HF Dataset] ${id}`;
  const author = id.includes("/") ? id.split("/")[0] : "HuggingFace Community";
  const downloads = dataset.downloads ? `${dataset.downloads.toLocaleString()} downloads` : "";
  const likes = dataset.likes ? `${dataset.likes} likes` : "";
  const tags = (dataset.tags || []).slice(0, 8).join(", ");

  const abstract = [
    dataset.description || dataset.cardData?.description || "Hugging Face Machine Learning Dataset.",
    `Stats: ${[downloads, likes].filter(Boolean).join(" | ")}`,
    tags ? `Tags: ${tags}` : null,
    dataset.license ? `License: ${dataset.license}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `hf-dataset:${id}`,
    title,
    authors: [author],
    year: dataset.createdAt ? new Date(dataset.createdAt).getFullYear() : (dataset.lastModified ? new Date(dataset.lastModified).getFullYear() : null),
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: dataset.likes || null,
    pdf_url: null,
    url: `https://huggingface.co/datasets/${id}`,
    source: "hf_datasets",
    venue: `Hugging Face Datasets Hub (${dataset.license || "Open Dataset"})`,
    tldr: `Dataset ${id} (${downloads || "HF"})`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Hugging Face",
    type: "dataset",
    issn: null,
    is_oa: true,
  };
}

// ── Harvard Dataverse ────────────────────────────────────────────────────────

export function fromDataverse(item) {
  const name = item.name || item.title || "(untitled dataset)";
  const authors = (item.authors || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
  const dateStr = item.published_at || item.publication_date || "";
  const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) || null : null;
  const doi = item.global_id?.replace(/^doi:/i, "") || null;

  const abstract = [
    item.description || "Research replication dataset archived on Harvard Dataverse.",
    item.affiliation ? `Affiliation: ${item.affiliation}` : null,
    item.storageIdentifier ? `Storage Identifier: ${item.storageIdentifier}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: doi ? `doi:${doi}` : `dataverse:${item.identifier || item.dataset_id || "item"}`,
    title: `[Dataverse] ${name}`,
    authors: authors.length > 0 ? authors : ["Dataverse Contributor"],
    year,
    doi,
    arxiv_id: null,
    abstract,
    citation_count: null,
    pdf_url: null,
    url: item.url || (doi ? `https://doi.org/${doi}` : "https://dataverse.harvard.edu"),
    source: "dataverse",
    venue: `Harvard Dataverse (${item.type || "Dataset"})`,
    tldr: `Dataverse: ${name.slice(0, 90)}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Harvard University / Dataverse Network",
    type: "dataset",
    issn: null,
    is_oa: true,
  };
}

// ── Stack Exchange / Stack Overflow ──────────────────────────────────────────

export function fromStackExchange(post) {
  const id = post.question_id || post.id || "0";
  const title = (post.title || "Stack Overflow Question")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const author = post.owner?.display_name || "Stack Overflow Community";
  const year = post.creation_date ? new Date(post.creation_date * 1000).getFullYear() : null;
  const score = post.score ? `Score: ${post.score}` : "";
  const answers = post.answer_count ? `${post.answer_count} answers` : "";
  const tags = (post.tags || []).join(", ");

  const cleanBody = (post.body || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);

  const abstract = [
    cleanBody || "Developer discussion and verified solutions on Stack Overflow.",
    `Stats: ${[score, answers, post.is_answered ? "✓ Accepted Answer" : null].filter(Boolean).join(" | ")}`,
    tags ? `Tags: [${tags}]` : null,
  ].filter(Boolean).join("\n\n");

  return {
    id: `stackoverflow:${id}`,
    title: `[Stack Overflow] ${title}`,
    authors: [author],
    year,
    doi: null,
    arxiv_id: null,
    abstract,
    citation_count: post.score || null,
    pdf_url: null,
    url: post.link || `https://stackoverflow.com/q/${id}`,
    source: "stackexchange",
    venue: `Stack Overflow (${tags || "Q&A"})`,
    tldr: `[Q&A] ${title.slice(0, 90)} (${score || "SO"})`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Stack Exchange Inc.",
    type: "discussion",
    issn: null,
    is_oa: true,
  };
}

// ── Software Heritage ────────────────────────────────────────────────────────

export function fromSoftwareHeritage(origin) {
  const url = origin.url || "";
  const title = `[Software Heritage] ${url.replace(/^https?:\/\//, "")}`;
  const swhid = origin.swhid || `swh:1:dir:${Buffer.from(url).toString("hex").slice(0, 40)}`;

  return {
    id: `swh:${Buffer.from(url).toString("base64url").slice(0, 24)}`,
    title,
    authors: ["Software Heritage Archive"],
    year: null,
    doi: null,
    arxiv_id: null,
    abstract: `Archived software origin repository preserved by Software Heritage (UNESCO partnership).\nOrigin URL: ${url}\nSWHID: ${swhid}`,
    citation_count: null,
    pdf_url: null,
    url: `https://archive.softwareheritage.org/browse/origin/directory/?origin_url=${encodeURIComponent(url)}`,
    source: "software_heritage",
    venue: "Software Heritage Universal Archive",
    tldr: `SWH Archive: ${url}`,
    volume: null,
    issue: null,
    pages: null,
    publisher: "Software Heritage / Inria / UNESCO",
    type: "software",
    issn: null,
    is_oa: true,
  };
}

// ── Theses & Dissertations (OATD) ────────────────────────────────────────────

export function fromDissertation(work) {
  const base = typeof work.display_name !== "undefined" ? fromOpenAlex(work) : work;
  return {
    ...base,
    title: `[PhD Dissertation / Thesis] ${base.title.replace(/^\[PhD Dissertation \/ Thesis\]\s*/i, "")}`,
    source: "oatd",
    type: "dissertation",
    venue: base.venue || "Doctoral Dissertation / Master's Thesis",
    is_oa: true,
  };
}

// ── WHO IRIS (Global Health) ─────────────────────────────────────────────────

export function fromWhoIris(doc) {
  const base = typeof doc.display_name !== "undefined" ? fromOpenAlex(doc) : doc;
  return {
    ...base,
    title: `[WHO Report] ${base.title.replace(/^\[WHO Report\]\s*/i, "")}`,
    source: "who_iris",
    publisher: "World Health Organization (WHO)",
    venue: base.venue || "WHO Institutional Repository for Information Sharing (IRIS)",
    type: "policy_report",
    is_oa: true,
  };
}

// ── DailyMed (FDA Drug Package Inserts) ──────────────────────────────────────

export function fromDailyMed(spl) {
  const title = spl.title ? `[FDA Drug Label] ${spl.title}` : "[FDA Drug Label] SPL Package Insert";
  const setId = spl.setid || spl.id || "spl";
  const year = spl.published_date ? parseInt(String(spl.published_date).slice(-4), 10) || null : null;

  return {
    id: `dailymed:${setId}`,
    title,
    authors: ["U.S. Food and Drug Administration (FDA) / NLM"],
    year,
    doi: null,
    arxiv_id: null,
    abstract: `FDA Structured Product Label (SPL) for ${spl.title || "medication"}. Contains approved indications, dosage, contraindications, and clinical pharmacology. Published: ${spl.published_date || "N/A"}.`,
    citation_count: null,
    pdf_url: `https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=${setId}&type=pdf`,
    url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`,
    source: "dailymed",
    venue: "DailyMed / National Library of Medicine",
    volume: null,
    issue: null,
    pages: null,
    publisher: "NIH National Library of Medicine",
    type: "drug_monograph",
    issn: null,
    is_oa: true,
  };
}

// ── Reactome (Biological Pathways) ──────────────────────────────────────────

export function fromReactome(item) {
  const stId = item.stId || item.dbId || "pathway";
  const name = item.name || item.displayName || "(Unnamed Pathway)";
  const species = Array.isArray(item.species) ? item.species.join(", ") : (item.species || "Homo sapiens");
  const type = item.type || item.className || "Pathway";
  const summary = item.summation ? (Array.isArray(item.summation) ? item.summation.map((s) => s.text).join(" ") : item.summation) : null;

  return {
    id: `reactome:${stId}`,
    title: `[Reactome ${type}] ${name} (${species})`,
    authors: ["Reactome Pathway Knowledgebase"],
    year: null,
    doi: item.doi || null,
    arxiv_id: null,
    abstract: summary || `Biological mechanism and reaction network for '${name}' in ${species}. Curated by Reactome.`,
    citation_count: null,
    pdf_url: null,
    url: `https://reactome.org/content/detail/${stId}`,
    source: "reactome",
    venue: "Reactome Biological Pathway Database",
    volume: null,
    issue: null,
    pages: null,
    publisher: "Reactome Consortium (EMBL-EBI, OICR, CSHL, NYU)",
    type: "pathway",
    issn: null,
    is_oa: true,
  };
}

// ── BindingDB (Drug-Target Affinities) ───────────────────────────────────────

export function fromBindingDb(item, targetName = "") {
  const id = item.monomerid || item.bdbid || item.id || `bind_${Math.random().toString(36).slice(2, 7)}`;
  const affinity = item.affinity || (item.ki ? `Ki: ${item.ki} nM` : (item.ic50 ? `IC50: ${item.ic50} nM` : ""));
  const smile = item.smile || item.smiles || "";
  const pmid = item.pmid ? `PMID: ${item.pmid}` : "";

  return {
    id: `bindingdb:${id}`,
    title: `[BindingDB Assay] Target: ${targetName || item.target || "Protein"} ${affinity ? `(${affinity})` : ""}`,
    authors: ["BindingDB Consortium"],
    year: null,
    doi: item.doi || null,
    arxiv_id: null,
    abstract: `Measured binding affinity assay for ligand ${id} interacting with ${targetName || item.target || "target protein"}. ${affinity ? `Affinity: ${affinity}. ` : ""}${smile ? `SMILES: ${smile}. ` : ""}${pmid}`,
    citation_count: null,
    pdf_url: null,
    url: `https://www.bindingdb.org/rweb/make_details.jsp?monomerid=${id}`,
    source: "bindingdb",
    venue: "Binding Database (BindingDB)",
    volume: null,
    issue: null,
    pages: null,
    publisher: "University of California San Diego (UCSD)",
    type: "assay_data",
    issn: null,
    is_oa: true,
  };
}

// ── ZINC (Small Molecules for Screening) ────────────────────────────────────

export function fromZinc(item) {
  const zincId = item.zinc_id || (item.substance_id ? `ZINC${item.substance_id}` : (item.name || "ZINC"));
  const smiles = item.smiles || "";
  const mwt = item.mwt ? `MW: ${item.mwt}` : "";
  const logp = item.logp ? `LogP: ${item.logp}` : "";

  return {
    id: `zinc:${zincId}`,
    title: `[ZINC Compound] ${zincId} ${mwt ? `(${mwt}, ${logp})` : ""}`,
    authors: ["ZINC Database / Irwin and Shoichet Laboratories"],
    year: null,
    doi: null,
    arxiv_id: null,
    abstract: `Commercially-available screening compound ${zincId}. ${mwt ? `${mwt}. ` : ""}${logp ? `${logp}. ` : ""}${smiles ? `SMILES: ${smiles}. ` : ""}Available for virtual docking and biological assays.`,
    citation_count: null,
    pdf_url: null,
    url: `https://zinc15.docking.org/substances/${zincId}/`,
    source: "zinc",
    venue: "ZINC Database of Commercially-Available Compounds for Virtual Screening",
    volume: null,
    issue: null,
    pages: null,
    publisher: "University of California San Francisco (UCSF)",
    type: "chemical_structure",
    issn: null,
    is_oa: true,
  };
}

// ── ChEMBL (Bioactive Molecules & Pharmacology) ─────────────────────────────

export function fromChembl(mol) {
  const chemblId = mol.molecule_chembl_id || mol.id || "chembl_mol";
  const prefName = mol.pref_name ? mol.pref_name.toUpperCase() : null;
  const title = prefName ? `[ChEMBL Molecule] ${prefName} (${chemblId})` : `[ChEMBL Molecule] ${chemblId}`;
  const props = mol.molecule_properties || {};
  const mw = props.full_mwt ? `MW: ${props.full_mwt}` : "";
  const logp = props.alogp ? `ALogP: ${props.alogp}` : "";
  const maxPhase = mol.max_phase ? `Max Phase: ${mol.max_phase}` : null;
  const smiles = mol.molecule_structures?.canonical_smiles || "";

  const descParts = [
    `Bioactive molecule catalogued in ChEMBL.`,
    maxPhase ? `Clinical Status: Phase ${mol.max_phase}.` : null,
    mw ? `${mw}.` : null,
    logp ? `${logp}.` : null,
    smiles ? `Canonical SMILES: ${smiles}` : null,
  ].filter(Boolean);

  return {
    id: `chembl:${chemblId}`,
    title,
    authors: ["EMBL-EBI ChEMBL Database"],
    year: null,
    doi: null,
    arxiv_id: null,
    abstract: descParts.join(" "),
    citation_count: null,
    pdf_url: null,
    url: `https://www.ebi.ac.uk/chembl/compound_report_card/${chemblId}/`,
    source: "chembl",
    venue: "ChEMBL Bioactive Molecule Database",
    volume: null,
    issue: null,
    pages: null,
    publisher: "European Molecular Biology Laboratory (EMBL-EBI)",
    type: "chemical_structure",
    issn: null,
    is_oa: true,
  };
}






