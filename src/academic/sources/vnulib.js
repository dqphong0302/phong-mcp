/**
 * VNULIB — Thư viện Trung tâm Đại học Quốc gia TP. Hồ Chí Minh (VNU-HCM).
 * Kho học liệu số, Luận án Tiến sĩ, Luận văn Thạc sĩ, Báo cáo NCKH,
 * và Giáo trình/Sách chuyên khảo thuộc hệ thống ĐHQG-HCM.
 *
 * OPAC Portal (Innovative Sierra WebPAC): https://opac.vnulib.edu.vn/
 * Search is anonymous; no patron login is needed to read the catalogue.
 *
 * Page shapes this adapter relies on:
 *   - result list: one `<div class="briefcitRow">` per record, bib id in the
 *     "save" checkbox, media type in `briefcitMedia` ALT, author + imprint as
 *     `<br>`-separated lines after `h2.briefcitTitle`, holdings in `bibItems`.
 *   - single hit: Sierra skips the list and serves the full record page
 *     (`bibInfoLabel` / `bibInfoData` rows), same as `record=bNNN`.
 */

import https from "node:https";
import tls from "node:tls";
import { stripHtml } from "./_ojs.js";
import { SECTIGO_DV_R36_PEM } from "./_vnulib-ca.js";

export const id = "vnulib";
export const name = "Thư viện Trung tâm ĐHQG-HCM (VNULIB)";
export const requiresKey = false;
export const keyEnvVar = null;
export const timeoutMs = 20000;
export const domains = [
  "vietnam_academic",
  "vietnam_theses",
  "vietnam_science",
  "vietnam_engineering",
  "vietnam_medical",
  "vietnam_social",
];

const BASE_URL = "https://opac.vnulib.edu.vn";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)";
/** Sierra shows 12 brief records per page; we do not follow pagination. */
const PAGE_SIZE = 12;

// The server sends the wrong intermediate — see _vnulib-ca.js. Verification stays on.
const opacAgent = new https.Agent({
  ca: [...tls.rootCertificates, SECTIGO_DV_R36_PEM],
  keepAlive: false,
});

const MEDIA_TYPES = {
  "dissertations-theses": "dissertation",
  books: "book",
  serials: "journal",
};

export function recordUrl(bibId) {
  return `${BASE_URL}/record=${bibId}~S1*vie`;
}

function fetchOpac(url, { signal, timeoutMs: ms = timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const req = https.get(
      new URL(url),
      {
        agent: opacAgent,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Connection: "close",
        },
        timeout: ms,
      },
      (res) => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
        res.on("error", reject);
      }
    );
    const onAbort = () => req.destroy(signal.reason ?? new Error("Aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    req.on("timeout", () => req.destroy(new Error("Timeout connecting to VNULIB OPAC")));
    req.on("error", reject);
  });
}

/** "Title : subtitle / Author." → "Title : subtitle" */
function cleanTitle(s) {
  return stripHtml(s).replace(/\s+\/\s+[^/]*$/, "").replace(/\s*[.:;,/]\s*$/, "").trim();
}

/** "Ho Chi Minh City : University of Technology, 2026." → { publisher, year } */
function parseImprint(line) {
  const text = stripHtml(line);
  const yr = text.match(/(?:^|[^\d])(1[5-9]\d{2}|20\d{2})(?!\d)/);
  const pub = text.match(/:\s*([^:]+?),?\s*(?:c?\[?\d{4}|$)/);
  return {
    year: yr ? parseInt(yr[1], 10) : null,
    publisher: pub ? pub[1].replace(/[.,\s]+$/, "").trim() || null : null,
  };
}

function looksLikeImprint(text) {
  return /:\s/.test(text) && /\d{4}/.test(text);
}

/** "Vũ, Thị Trang, tác giả." → "Vũ, Thị Trang" (drops MARC relator terms). */
function cleanAuthor(s) {
  return stripHtml(s)
    .replace(/,\s*(?:tác giả|chủ biên|đồng chủ biên|biên soạn|người hướng dẫn|hướng dẫn|dịch|author|editor|ed\.)\s*[.,;]*$/i, "")
    .replace(/[.,;\s]+$/, "")
    .trim();
}

function mapMediaType(alt) {
  return MEDIA_TYPES[String(alt || "").trim().toLowerCase()] || "other";
}

/** First holdings row: [barcode, call number, loan policy, status, location]. */
function parseHoldings(block) {
  const row = block.match(/<tr[^>]*class="bibItemsEntry"[^>]*>([\s\S]*?)<\/tr>/i);
  if (!row) return { call_number: null, location: null };
  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripHtml(m[1]));
  return { call_number: cells[1] || null, location: cells[4] || null };
}

function buildPaper(rec) {
  const url = recordUrl(rec.bibId);
  return {
    id: `vnulib:${rec.bibId}`,
    title: rec.title,
    authors: rec.authors || [],
    year: rec.year ?? null,
    doi: null,
    arxiv_id: null,
    // Never pad with boilerplate: screening / evidence checks read this field.
    abstract: rec.abstract || null,
    citation_count: null,
    pdf_url: null,
    url,
    // Direct link the user can open to reach the record or its digital copy.
    access_url: rec.fulltext_url || url,
    fulltext_url: rec.fulltext_url || null,
    source: "vnulib",
    venue: rec.location || "Thư viện ĐHQG-HCM",
    volume: null,
    issue: null,
    pages: null,
    publisher: rec.publisher || null,
    type: rec.type || "other",
    issn: null,
    is_oa: false,
    subjects: rec.subjects || [],
    call_number: rec.call_number || null,
    degree: rec.degree || null,
  };
}

/** Parse the brief-results page into records. */
export function parseBriefResults(html) {
  const blocks = html.split(/<div class="briefcitRow">/i).slice(1);
  const records = [];
  for (const block of blocks) {
    const bib = block.match(/name=["']save["'][^>]*value=["'](b\d+)["']/i);
    const titleM = block.match(/<h2[^>]*class="briefcitTitle"[^>]*>([\s\S]*?)<\/h2>/i);
    if (!bib || !titleM) continue;
    const title = cleanTitle(titleM[1]);
    if (!title) continue;

    const media = block.match(/class="briefcitMedia"[^>]*>\s*<img[^>]*alt=["']([^"']*)["']/i);

    // Lines between the title and the ratings/request block: [author], imprint.
    const afterTitle = block.slice(titleM.index + titleM[0].length);
    const stop = afterTitle.search(/<div class="briefcit(?:Ratings|Request|Actions|Status)/i);
    const lines = (stop >= 0 ? afterTitle.slice(0, stop) : afterTitle)
      .split(/<br\s*\/?\s*>/i)
      .map((l) => stripHtml(l))
      .filter(Boolean);

    let authors = [];
    let imprint = { year: null, publisher: null };
    for (const line of lines) {
      if (looksLikeImprint(line)) imprint = parseImprint(line);
      else if (!authors.length) authors = [cleanAuthor(line)].filter(Boolean);
    }

    records.push({
      bibId: bib[1],
      title,
      authors,
      ...imprint,
      type: mapMediaType(media?.[1]),
      ...parseHoldings(block),
    });
  }
  return records;
}

/** Parse a full record page (`record=bNNN`, or a single-hit search). */
export function parseRecordPage(html) {
  const bib = html.match(/\/record=(b\d+)/i);
  if (!bib) return null;

  // Rows are `<td class="bibInfoLabel">X:</td><td class="bibInfoData">…</td>`;
  // continuation rows carry an empty label and belong to the previous one.
  const fields = {};
  let label = null;
  const rowRe = /<tr>(?:<!--[^>]*-->)?\s*<td[^>]*>((?:(?!<\/td>)[\s\S])*)<\/td>\s*<td class="bibInfoData">((?:(?!<\/td>)[\s\S])*)<\/td>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const l = stripHtml(m[1]).replace(/:\s*$/, "");
    if (l) label = l;
    if (!label) continue;
    (fields[label] ||= []).push(m[2]);
  }
  const first = (k) => fields[k]?.[0];
  const all = (k) => (fields[k] || []).map(stripHtml).filter(Boolean);

  const title = first("Nhan đề") ? cleanTitle(first("Nhan đề")) : null;
  if (!title) return null;

  const authors = Object.keys(fields)
    .filter((k) => k.startsWith("Tác giả"))
    .flatMap((k) => fields[k].map(cleanAuthor))
    .filter(Boolean);

  const links = html.match(/<table[^>]*class="bibLinks"[^>]*>([\s\S]*?)<\/table>/i);
  const href = links?.[1].match(/<a[^>]+href=["']\s*([^"']+?)\s*["']/i);

  const degree = first("Luận văn-Luận án") ? stripHtml(first("Luận văn-Luận án")) : null;
  const media = html.match(/<img[^>]*src="\/screens\/[^"]*"[^>]*alt=["'](Dissertations-Theses|Books|Serials)["']/i);

  return {
    bibId: bib[1],
    title,
    authors,
    ...parseImprint(first("Xuất bản") || ""),
    abstract: first("Tóm tắt") ? stripHtml(first("Tóm tắt")) : null,
    subjects: all("Chủ đề"),
    degree,
    type: degree ? "dissertation" : mapMediaType(media?.[1]),
    fulltext_url: href ? new URL(href[1], BASE_URL).href : null,
    ...parseHoldings(html),
  };
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const searchUrl = `${BASE_URL}/search*vie/?searchtype=Y&searcharg=${encodeURIComponent(query)}&SORT=D`;

  try {
    const resp = await fetchOpac(searchUrl, { signal });
    if (!resp.ok) return { papers: [], total: 0, error: `VNULIB OPAC HTTP ${resp.status}` };
    const html = resp.body;

    let records;
    let total;
    if (/class="briefcitRow"/i.test(html)) {
      records = parseBriefResults(html);
      const t = html.match(/\(\s*\d+\s*-\s*\d+\s+(?:của|of)\s+([\d.,]+)\s*\)/i);
      total = t ? parseInt(t[1].replace(/[.,]/g, ""), 10) : records.length;
    } else {
      const single = parseRecordPage(html);
      records = single ? [single] : [];
      total = records.length;
    }

    const papers = records
      .filter((r) => r.year == null || ((!year_min || r.year >= year_min) && (!year_max || r.year <= year_max)))
      .slice(0, Math.min(limit, PAGE_SIZE))
      .map(buildPaper);

    return { papers, total };
  } catch (err) {
    return { papers: [], total: 0, error: err.message };
  }
}

export async function getById(paperId, _config = {}, opts = {}) {
  const m = String(paperId).match(/^vnulib:(b?\d+)$/i);
  if (!m) return null;
  const bibId = m[1].startsWith("b") ? m[1] : `b${m[1]}`;
  const resp = await fetchOpac(recordUrl(bibId), { signal: opts.signal });
  if (!resp.ok) return null;
  const rec = parseRecordPage(resp.body);
  return rec ? buildPaper(rec) : null;
}
