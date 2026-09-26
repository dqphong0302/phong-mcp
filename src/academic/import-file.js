/**
 * Academic file import parser.
 * Parses reference files exported from Scopus, Web of Science, EndNote, etc.
 * and normalizes them into the standard AcademicPaper shape.
 *
 * Supported formats:
 *   - BibTeX (.bib)
 *   - RIS (.ris)
 *   - Scopus CSV (.csv)
 *   - Web of Science Plain Text (.txt)
 *   - MEDLINE/NBIB (.nbib)
 *   - CSL-JSON (.json)
 */

import { readFileSync } from "fs";
import { extname } from "path";

// ── Format detection ──────────────────────────────────────────────────────────

/**
 * Auto-detect file format from extension and content heuristics.
 * @param {string} filePath
 * @param {string} content
 * @returns {string}
 */
export function detectFormat(filePath, content) {
  const ext = extname(filePath).toLowerCase();
  const firstLine = content.trimStart().split("\n")[0] || "";

  // Extension-based detection
  if (ext === ".bib") return "bibtex";
  if (ext === ".ris") return "ris";
  if (ext === ".nbib") return "medline";
  if (ext === ".enw") return "ris"; // EndNote export is RIS-like

  // Content-based detection
  if (firstLine.startsWith("@")) return "bibtex";
  if (firstLine.startsWith("TY  - ")) return "ris";
  if (firstLine.startsWith("PMID-") || firstLine.startsWith("OWN -")) return "medline";
  if (firstLine.startsWith("FN ") || firstLine.startsWith("PT ")) return "wos";
  if (content.trimStart().startsWith("[")) {
    try { JSON.parse(content); return "csl_json"; } catch { /* not JSON */ }
  }

  // CSV detection (Scopus exports have specific headers)
  if (ext === ".csv" || firstLine.includes('"Authors"') || firstLine.includes('"Title"')) {
    return "scopus_csv";
  }
  if (ext === ".json") {
    try { JSON.parse(content); return "csl_json"; } catch { /* not JSON */ }
  }

  return "unknown";
}

// ── BibTeX Parser ─────────────────────────────────────────────────────────────

/**
 * Parse BibTeX file content into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseBibTeX(content) {
  const papers = [];
  // Match @type{key, ... }
  const entryRe = /@(\w+)\s*\{([^,]*),\s*([\s\S]*?)(?=\n@|\n*$)/g;
  let match;

  while ((match = entryRe.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;

    const key = match[2].trim();
    const body = match[3];

    // Extract fields
    const fields = {};
    const fieldRe = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields[fm[1].toLowerCase()] = (fm[2] || fm[3] || fm[4] || "").trim();
    }

    // Skip crossref-only aliases
    if (fields.crossref && Object.keys(fields).length <= 1) continue;

    const authors = _parseBibAuthors(fields.author || "");
    const doi = fields.doi?.replace(/^https?:\/\/doi\.org\//i, "") || null;
    const arxivMatch = (fields.eprint || fields.journal || "").match(/(\d{4}\.\d{4,5})/);

    papers.push({
      id: doi ? `doi:${doi}` : key,
      title: _cleanBibValue(fields.title || "Untitled"),
      authors,
      year: parseInt(fields.year) || null,
      doi,
      arxiv_id: arxivMatch?.[1] || null,
      abstract: _cleanBibValue(fields.abstract || null),
      citation_count: null,
      pdf_url: fields.url?.endsWith(".pdf") ? fields.url : null,
      url: fields.url || (doi ? `https://doi.org/${doi}` : null),
      source: "import:bibtex",
      venue: _cleanBibValue(fields.journal || fields.booktitle || null),
      tldr: null,
      volume: fields.volume || null,
      issue: fields.number || null,
      pages: fields.pages || null,
      publisher: fields.publisher || null,
      type: _mapBibType(type),
      issn: fields.issn || null,
      is_oa: false,
      _import_key: key,
    });
  }

  return papers;
}

function _parseBibAuthors(authorStr) {
  if (!authorStr) return [];
  return authorStr
    .replace(/\band\b/gi, ";")
    .split(";")
    .map((a) => a.trim().replace(/[{}]/g, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function _cleanBibValue(val) {
  if (!val) return val;
  return val.replace(/[{}]/g, "").replace(/\\\&/g, "&").replace(/\\_/g, "_").replace(/\\%/g, "%").trim();
}

function _mapBibType(bibType) {
  const map = { article: "article", inproceedings: "conference", conference: "conference",
    incollection: "book_chapter", inbook: "book_chapter", misc: "other", techreport: "other" };
  return map[bibType] || "article";
}

// ── RIS Parser ────────────────────────────────────────────────────────────────

/**
 * Parse RIS file content into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseRIS(content) {
  const papers = [];
  // Split into records by "ER  - "
  const blocks = content.split(/\nER\s*-\s*/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const fields = {};
    const authors = [];
    const lines = block.split("\n");

    for (const line of lines) {
      const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s(.*)$/);
      if (!m) continue;
      const [, tag, value] = m;
      const v = value.trim();

      if (tag === "AU" || tag === "A1") {
        authors.push(v);
      } else if (fields[tag]) {
        fields[tag] += "; " + v;
      } else {
        fields[tag] = v;
      }
    }

    if (!fields.TY && !fields.TI) continue; // Not a valid record

    const doi = fields.DO?.replace(/^https?:\/\/doi\.org\//i, "") || null;
    const year = parseInt(fields.PY || fields.Y1 || fields.DA?.slice(0, 4) || "") || null;

    papers.push({
      id: doi ? `doi:${doi}` : `ris:${papers.length + 1}`,
      title: fields.TI || fields.T1 || "Untitled",
      authors: authors.length ? authors : (fields.AU ? [fields.AU] : []),
      year,
      doi,
      arxiv_id: _extractArxivFromUrl(fields.UR || fields.L1 || ""),
      abstract: fields.AB || fields.N2 || null,
      citation_count: null,
      pdf_url: fields.L1?.endsWith(".pdf") ? fields.L1 : null,
      url: fields.UR || (doi ? `https://doi.org/${doi}` : null),
      source: "import:ris",
      venue: fields.JO || fields.JF || fields.T2 || fields.J2 || null,
      tldr: null,
      volume: fields.VL || null,
      issue: fields.IS || null,
      pages: fields.SP ? (fields.EP ? `${fields.SP}-${fields.EP}` : fields.SP) : null,
      publisher: fields.PB || null,
      type: _mapRisType(fields.TY),
      issn: fields.SN || null,
      is_oa: false,
    });
  }

  return papers;
}

function _mapRisType(ty) {
  const map = { JOUR: "article", CONF: "conference", CPAPER: "conference",
    CHAP: "book_chapter", RPRT: "other", THES: "other" };
  return map[ty] || "article";
}

// ── Scopus CSV Parser ─────────────────────────────────────────────────────────

/**
 * Parse Scopus CSV export into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseScopusCSV(content) {
  const papers = [];
  const rows = _parseCSV(content);
  if (rows.length < 2) return papers;

  // Normalize headers
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const col = (name) => headers.indexOf(name);

  // Common Scopus column names
  const titleIdx = _findCol(headers, ["title"]);
  const authorsIdx = _findCol(headers, ["authors", "author"]);
  const yearIdx = _findCol(headers, ["year", "publication year"]);
  const doiIdx = _findCol(headers, ["doi"]);
  const abstractIdx = _findCol(headers, ["abstract"]);
  const sourceIdx = _findCol(headers, ["source title", "journal", "source"]);
  const volumeIdx = _findCol(headers, ["volume"]);
  const issueIdx = _findCol(headers, ["issue"]);
  const pagesIdx = _findCol(headers, ["page start", "pages"]);
  const pageEndIdx = _findCol(headers, ["page end"]);
  const citedIdx = _findCol(headers, ["cited by", "citations"]);
  const pubIdx = _findCol(headers, ["publisher"]);
  const typeIdx = _findCol(headers, ["document type", "type"]);
  const oaIdx = _findCol(headers, ["open access"]);
  const urlIdx = _findCol(headers, ["link", "url"]);

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || !r[titleIdx]) continue;

    const doi = r[doiIdx]?.replace(/^https?:\/\/doi\.org\//i, "") || null;
    const pages = r[pagesIdx] || "";
    const pageEnd = r[pageEndIdx] || "";
    const pageRange = pageEnd ? `${pages}-${pageEnd}` : pages;

    papers.push({
      id: doi ? `doi:${doi}` : `scopus:${i}`,
      title: r[titleIdx] || "Untitled",
      authors: r[authorsIdx]?.split(/[,;]/).map((a) => a.trim()).filter(Boolean).slice(0, 20) || [],
      year: parseInt(r[yearIdx]) || null,
      doi,
      arxiv_id: null,
      abstract: r[abstractIdx] || null,
      citation_count: parseInt(r[citedIdx]) || null,
      pdf_url: null,
      url: r[urlIdx] || (doi ? `https://doi.org/${doi}` : null),
      source: "import:scopus",
      venue: r[sourceIdx] || null,
      tldr: null,
      volume: r[volumeIdx] || null,
      issue: r[issueIdx] || null,
      pages: pageRange || null,
      publisher: r[pubIdx] || null,
      type: _mapDocType(r[typeIdx]),
      issn: null,
      is_oa: (r[oaIdx] || "").toLowerCase() === "yes",
    });
  }

  return papers;
}

function _findCol(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx >= 0) return idx;
  }
  return -1;
}

function _mapDocType(docType) {
  if (!docType) return "article";
  const t = docType.toLowerCase();
  if (t.includes("conference") || t.includes("proceeding")) return "conference";
  if (t.includes("book") || t.includes("chapter")) return "book_chapter";
  if (t.includes("review") || t.includes("article")) return "article";
  return "other";
}

// ── Web of Science Parser ─────────────────────────────────────────────────────

/**
 * Parse Web of Science Plain Text export into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseWoS(content) {
  const papers = [];
  // WoS records are separated by "ER\n"
  const blocks = content.split(/\nER\n/);

  for (const block of blocks) {
    if (!block.trim() || block.trim().startsWith("FN ")) continue;

    const fields = {};
    const authors = [];
    let currentTag = "";

    for (const line of block.split("\n")) {
      const tagMatch = line.match(/^([A-Z][A-Z0-9])\s(.*)$/);
      if (tagMatch) {
        currentTag = tagMatch[1];
        const value = tagMatch[2].trim();
        if (currentTag === "AU" || currentTag === "AF") {
          authors.push(value);
        } else if (fields[currentTag]) {
          fields[currentTag] += " " + value;
        } else {
          fields[currentTag] = value;
        }
      } else if (line.startsWith("   ") && currentTag) {
        // Continuation line
        const value = line.trim();
        if (currentTag === "AU" || currentTag === "AF") {
          authors.push(value);
        } else {
          fields[currentTag] = (fields[currentTag] || "") + " " + value;
        }
      }
    }

    if (!fields.TI && !fields.PT) continue;

    const doi = fields.DI?.replace(/^https?:\/\/doi\.org\//i, "") || null;

    papers.push({
      id: doi ? `doi:${doi}` : `wos:${papers.length + 1}`,
      title: fields.TI || "Untitled",
      authors: authors.length ? [...new Set(authors)].slice(0, 20) : [],
      year: parseInt(fields.PY) || null,
      doi,
      arxiv_id: _extractArxivFromUrl(fields.UT || ""),
      abstract: fields.AB || null,
      citation_count: parseInt(fields.TC) || null,
      pdf_url: null,
      url: doi ? `https://doi.org/${doi}` : null,
      source: "import:wos",
      venue: fields.SO || fields.SE || null,
      tldr: null,
      volume: fields.VL || null,
      issue: fields.IS || null,
      pages: fields.BP ? (fields.EP ? `${fields.BP}-${fields.EP}` : fields.BP) : null,
      publisher: fields.PU || null,
      type: _mapWosType(fields.DT || fields.PT),
      issn: fields.SN || null,
      is_oa: (fields.OA || "").toLowerCase().includes("gold"),
    });
  }

  return papers;
}

function _mapWosType(dt) {
  if (!dt) return "article";
  const t = dt.toLowerCase();
  if (t.includes("proceeding") || t === "s") return "conference";
  if (t.includes("book") || t === "b") return "book_chapter";
  return "article";
}

// ── MEDLINE/NBIB Parser ──────────────────────────────────────────────────────

/**
 * Parse MEDLINE/NBIB export into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseMEDLINE(content) {
  const papers = [];
  // Records separated by blank lines after a block
  const blocks = content.split(/\n\s*\n(?=PMID)/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const fields = {};
    const authors = [];
    let currentTag = "";

    for (const line of block.split("\n")) {
      const tagMatch = line.match(/^([A-Z]{2,4})\s*-\s*(.*)$/);
      if (tagMatch) {
        currentTag = tagMatch[1].trim();
        const value = tagMatch[2].trim();
        if (currentTag === "AU" || currentTag === "FAU") {
          if (currentTag === "AU") authors.push(value);
        } else if (fields[currentTag]) {
          fields[currentTag] += " " + value;
        } else {
          fields[currentTag] = value;
        }
      } else if (line.startsWith("      ") && currentTag) {
        fields[currentTag] = (fields[currentTag] || "") + " " + line.trim();
      }
    }

    if (!fields.TI && !fields.PMID) continue;

    // Extract DOI from AID field
    const aidDoi = fields.AID?.match(/(10\.\d{4,9}\/[^\s\[]+)/)?.[1] || null;
    const pmid = fields.PMID || null;

    papers.push({
      id: aidDoi ? `doi:${aidDoi}` : (pmid ? `pmid:${pmid}` : `medline:${papers.length + 1}`),
      title: fields.TI || "Untitled",
      authors: authors.slice(0, 20),
      year: parseInt(fields.DP?.slice(0, 4)) || null,
      doi: aidDoi,
      arxiv_id: null,
      abstract: fields.AB || null,
      citation_count: null,
      pdf_url: null,
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
      source: "import:medline",
      venue: fields.JT || fields.TA || null,
      tldr: null,
      volume: fields.VI || null,
      issue: fields.IP || null,
      pages: fields.PG || null,
      publisher: null,
      type: "article",
      issn: fields.IS || null,
      is_oa: false,
      _pmid: pmid,
    });
  }

  return papers;
}

// ── CSL-JSON Parser ──────────────────────────────────────────────────────────

/**
 * Parse CSL-JSON file into paper records.
 * @param {string} content
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function parseCSLJSON(content) {
  let items;
  try {
    items = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) items = [items];

  return items.map((item, i) => {
    const authors = (item.author || []).map(
      (a) => [a.given, a.family].filter(Boolean).join(" ") || a.literal || ""
    ).filter(Boolean);
    const year = item.issued?.["date-parts"]?.[0]?.[0] || null;

    return {
      id: item.DOI ? `doi:${item.DOI}` : item.id || `csl:${i + 1}`,
      title: item.title || "Untitled",
      authors,
      year: year ? parseInt(year) : null,
      doi: item.DOI || null,
      arxiv_id: _extractArxivFromUrl(item.URL || ""),
      abstract: item.abstract || null,
      citation_count: null,
      pdf_url: null,
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
      source: "import:csl-json",
      venue: item["container-title"] || null,
      tldr: null,
      volume: item.volume?.toString() || null,
      issue: item.issue?.toString() || null,
      pages: item.page || null,
      publisher: item.publisher || null,
      type: _mapCslType(item.type),
      issn: item.ISSN?.[0] || null,
      is_oa: false,
    };
  });
}

function _mapCslType(cslType) {
  if (!cslType) return "article";
  if (cslType.includes("paper-conference")) return "conference";
  if (cslType.includes("chapter")) return "book_chapter";
  return "article";
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _extractArxivFromUrl(url) {
  if (!url) return null;
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  return m ? m[1] : null;
}

// ── Simple CSV parser (no external deps) ──────────────────────────────────────

function _parseCSV(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && content[i + 1] === "\n")) {
        row.push(field);
        field = "";
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  if (field || row.length) {
    row.push(field);
    if (row.some((c) => c.trim())) rows.push(row);
  }

  return rows;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Deduplicate papers by DOI, then normalized title+year.
 * @param {import("./formatter.js").AcademicPaper[]} papers
 * @returns {import("./formatter.js").AcademicPaper[]}
 */
export function deduplicateImported(papers) {
  const seen = new Map(); // key → paper (keep first occurrence, enrich from later)

  for (const p of papers) {
    // Primary: DOI
    if (p.doi) {
      const dk = `doi:${p.doi.toLowerCase()}`;
      if (seen.has(dk)) {
        _merge(seen.get(dk), p);
        continue;
      }
      seen.set(dk, p);
      continue;
    }

    // Secondary: normalized title + year
    const titleKey = _normalizeTitle(p.title) + "|" + (p.year || "");
    if (seen.has(titleKey)) {
      _merge(seen.get(titleKey), p);
      continue;
    }
    seen.set(titleKey, p);
  }

  return [...seen.values()];
}

function _normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function _merge(existing, incoming) {
  // Fill in missing fields from incoming
  for (const key of ["abstract", "doi", "arxiv_id", "pdf_url", "url", "venue",
    "volume", "issue", "pages", "publisher", "issn"]) {
    if (!existing[key] && incoming[key]) existing[key] = incoming[key];
  }
  if (!existing.citation_count && incoming.citation_count) {
    existing.citation_count = incoming.citation_count;
  }
  if (incoming.authors?.length > existing.authors?.length) {
    existing.authors = incoming.authors;
  }
}

// ── Main parse entry point ────────────────────────────────────────────────────

/**
 * Parse a reference file and return normalized paper records.
 * @param {string} filePath - Absolute path to the file
 * @param {string} [format="auto"] - Format hint
 * @param {boolean} [deduplicate=true] - Whether to deduplicate results
 * @returns {{ papers: import("./formatter.js").AcademicPaper[], format: string, duplicates_removed: number }}
 */
export function parseReferenceFile(filePath, format = "auto", deduplicate = true) {
  const content = readFileSync(filePath, "utf-8");

  if (format === "auto") {
    format = detectFormat(filePath, content);
  }

  let papers;
  switch (format) {
    case "bibtex":    papers = parseBibTeX(content); break;
    case "ris":       papers = parseRIS(content); break;
    case "scopus_csv": papers = parseScopusCSV(content); break;
    case "wos":       papers = parseWoS(content); break;
    case "medline":   papers = parseMEDLINE(content); break;
    case "csl_json":  papers = parseCSLJSON(content); break;
    default:
      throw new Error(`Unknown format: "${format}". Supported: bibtex, ris, scopus_csv, wos, medline, csl_json`);
  }

  const totalBefore = papers.length;
  if (deduplicate) {
    papers = deduplicateImported(papers);
  }

  return {
    papers,
    format,
    duplicates_removed: totalBefore - papers.length,
  };
}

// ── Test helper ───────────────────────────────────────────────────────────────

export function testParsers() {
  console.log("Import parser module loaded successfully.");
  console.log("Supported formats: bibtex, ris, scopus_csv, wos, medline, csl_json");
  console.log("Functions: parseReferenceFile(filePath, format, deduplicate)");
}
