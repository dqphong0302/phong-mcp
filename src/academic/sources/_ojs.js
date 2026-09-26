/**
 * Shared parser for OJS 3.x (Open Journal Systems) search result pages.
 *
 * Used by the Vietnamese OJS portals: VJOL (vjol.info.vn), VAST (vjs.ac.vn),
 * JST/HUST (jst.vn). All three expose the site-wide search endpoint
 *   {base}/index.php/index/search/search?query=...
 * and render results with the standard `obj_article_summary` markup.
 *
 * Design notes:
 *  - Block splitting (not a single greedy regex) so nested <div>s and theme
 *    variations do not silently drop every result.
 *  - NEVER fabricates metadata: unknown author / abstract / year stay empty
 *    or null so downstream screening, PRISMA and citation formatting cannot
 *    quote invented text.
 *  - Extracts the galley PDF link when the theme renders one, so Vietnamese
 *    papers (which have no DOI) still satisfy `open_access_only`.
 */

import { contentTermsRaw } from "./_relevance.js";

const DEFAULT_TIMEOUT_MS = 15000;

/** Combine the caller's abort signal with a local timeout. */
export function withTimeout(signal, ms = DEFAULT_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#039;": "'", "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

/** Strip tags + decode the handful of entities OJS emits. */
export function stripHtml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#0?39|apos|nbsp);/g, (m) => ENTITIES[m] ?? ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull the text of the first element carrying `class="<name>"`. */
function pickByClass(block, name) {
  const re = new RegExp(`<(\\w+)[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  const m = block.match(re);
  return m ? stripHtml(m[2]) : null;
}

/**
 * Split author text into a list. Returns [] when nothing usable is found —
 * callers must not substitute a placeholder name.
 */
function parseAuthors(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]|\sand\s|\svà\s/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && a.length < 120);
}

/** Year from a "Published" / "Đã xuất bản" cell. Null when absent — never "today". */
function parseYear(text) {
  if (!text) return null;
  const m = String(text).match(/\b(19\d\d|20\d\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** OJS pagination footer: "1 - 25 of 133" / "1 - 25 trong số 133". */
function parseTotal(html) {
  const m = html.match(/(\d[\d,.]*)\s*[-–]\s*(\d[\d,.]*)\s+(?:of|trong s(?:ố|o))\s+(\d[\d,.]*)/i);
  if (!m) return null;
  const n = parseInt(m[3].replace(/[,.]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an OJS 3 search result page.
 *
 * @param {string} html
 * @param {Object} o
 * @param {string} o.baseUrl        - e.g. "https://vjol.info.vn"
 * @param {string} o.sourceId       - registry id, used for `source` and the id prefix
 * @param {string} o.publisher
 * @param {string} o.defaultVenue
 * @param {Object} [o.journalNames] - map of URL slug → full journal name
 * @param {string|null} [o.issn]
 * @param {number} [o.limit]
 * @param {number} [o.yearMin]
 * @param {number} [o.yearMax]
 * @returns {{papers: Array, total: number}}
 */
export function parseOjsSearch(html, o) {
  const {
    baseUrl, sourceId, publisher, defaultVenue,
    journalNames = {}, issn = null, limit = 10, yearMin, yearMax,
  } = o;

  // Split on any element whose class contains obj_article_summary / article-summary.
  // slice(1) drops everything before the first result.
  const blocks = html
    .split(/<(?:div|li|article)[^>]*class=["'][^"']*(?:obj_article_summary|article-summary)[^"']*["'][^>]*>/i)
    .slice(1);

  const papers = [];
  const seen = new Set();

  for (const block of blocks) {
    if (papers.length >= limit) break;

    const hrefRe = /href=["']((?:https?:\/\/[^"']+)?\/[^"']*?\/article\/view\/(\d+)(?:\/(\d+))?[^"']*)["']/gi;
    let landing = null, artId = null, galley = null, slug = "";
    let m;
    while ((m = hrefRe.exec(block)) !== null) {
      const [, href, id, galleyId] = m;
      if (galleyId) {
        // /article/view/<article>/<galley> — a full-text galley link
        if (!galley) galley = href;
        if (!artId) artId = id;
      } else if (!landing) {
        landing = href;
        artId = id;
      }
    }
    if (!artId) continue;
    if (seen.has(artId)) continue;
    seen.add(artId);

    const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${baseUrl}${u.startsWith("/") ? "" : "/"}${u}`);
    const landingUrl = abs(landing) || abs(galley);
    if (!landingUrl) continue;

    const slugMatch = landingUrl.match(/\/index\.php\/([^/]+)\//) || landingUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/article\//);
    if (slugMatch) slug = slugMatch[1].toLowerCase();

    // Title: prefer the .title element, fall back to the anchor that carries id="article-N"
    let title = pickByClass(block, "title");
    if (!title) {
      const anchor = block.match(new RegExp(`<a[^>]*id=["']article-${artId}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))
                  || block.match(/<a[^>]*\/article\/view\/[^>]*>([\s\S]*?)<\/a>/i);
      title = anchor ? stripHtml(anchor[1]) : null;
    }
    // OJS nests the journal name inside .title as .subtitle — split it off.
    const subtitle = pickByClass(block, "subtitle");
    if (title && subtitle && title.endsWith(subtitle)) title = title.slice(0, -subtitle.length).trim();
    if (!title || title.length < 4) continue;

    // The page itself is authoritative; the slug map is only a fallback so a
    // stale hardcoded journal name can never override the real venue.
    const venue = subtitle
      || pickByClass(block, "contextName")
      || journalNames[slug]
      || defaultVenue;

    const authors = parseAuthors(pickByClass(block, "authors") || pickByClass(block, "meta"));
    const year = parseYear(pickByClass(block, "published") || pickByClass(block, "date"));

    // Unknown year must not be filtered out as if it were the current year.
    if (year != null) {
      if (yearMin && year < yearMin) continue;
      if (yearMax && year > yearMax) continue;
    }

    let pdfUrl = null;
    const dl = block.match(/href=["']([^"']*\/article\/download\/\d+\/\d+[^"']*)["']/i);
    if (dl) pdfUrl = abs(dl[1]);
    else if (galley) pdfUrl = abs(galley).replace("/article/view/", "/article/download/");

    papers.push({
      id: `${sourceId}:${artId}`,
      title,
      authors,
      year,
      doi: null,
      arxiv_id: null,
      abstract: null,
      citation_count: null,
      pdf_url: pdfUrl,
      url: landingUrl,
      source: sourceId,
      venue,
      volume: null,
      issue: null,
      pages: pickByClass(block, "pages"),
      publisher,
      type: "article",
      issn,
      is_oa: true,
    });
  }

  return { papers, total: parseTotal(html) ?? papers.length };
}

/**
 * Fetch + parse an OJS 3 site-wide search. Shared by the three VN OJS plugins.
 *
 * @param {string} query
 * @param {Object} opts   - { limit, year_min, year_max, signal }
 * @param {Object} site   - { baseUrl, sourceId, publisher, defaultVenue, journalNames, issn }
 */
/** Some portals answer only on the www host, others only without it. */
function hostVariants(baseUrl) {
  const out = [baseUrl];
  if (/^https?:\/\/www\./i.test(baseUrl)) out.push(baseUrl.replace(/\/\/www\./i, "//"));
  else out.push(baseUrl.replace(/^(https?:\/\/)/i, "$1www."));
  return out;
}

export async function searchOjsSite(query, opts = {}, site) {
  const { limit = 10, year_min, year_max, signal } = opts;

  // OJS ANDs every term together, so a natural-language query ("đái tháo đường
  // type 2 tuân thủ điều trị") matches nothing even though the corpus is full
  // of relevant papers. Retry with progressively fewer — but more distinctive —
  // terms instead of reporting an empty corpus.
  const merged = [];
  const seen = new Set();
  let total = 0;

  for (const q of queryVariants(query)) {
    // Try the configured host first; if it yields nothing, try the www variant
    // once. Costs an extra request only when the first host returns empty.
    for (const base of hostVariants(site.baseUrl)) {
      const r = await _searchOjsOnce(q, { limit, year_min, year_max, signal }, { ...site, baseUrl: base });
      if (!r.papers.length) continue;
      for (const p of r.papers) {
        const key = p.id || p.url || p.title;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
      }
      total = Math.max(total, r.total || 0);
      break;
    }
    // A narrower variant only runs while the result set is still thin, so the
    // precise query keeps its ranking when it was good enough on its own.
    if (merged.length >= limit) break;
  }

  return { papers: merged.slice(0, limit), total: Math.max(total, merged.length) };
}

/**
 * The query spellings to try, widest match last.
 *
 * Terms keep their original diacritics: the Vietnamese OJS portals index
 * accented text and return nothing for the folded spelling.
 *
 * @param {string} query
 * @returns {string[]}
 */
function queryVariants(query) {
  const full = String(query || "").trim();
  const terms = contentTermsRaw(full);
  const variants = [full];

  // Longest terms first — they are the most discriminating ones.
  const ranked = [...terms].sort((a, b) => b.length - a.length);
  for (const n of [4, 2]) {
    if (terms.length <= n) continue;
    // Emit in the query's own word order so OJS phrase ranking still applies.
    const keep = new Set(ranked.slice(0, n));
    const v = terms.filter((t) => keep.has(t)).join(" ");
    if (v && !variants.includes(v)) variants.push(v);
  }
  return variants;
}

async function _searchOjsOnce(query, opts, site) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const url = `${site.baseUrl}/index.php/index/search/search?query=${encodeURIComponent(query)}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: withTimeout(signal),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const html = await resp.text();
    return parseOjsSearch(html, { ...site, limit, yearMin: year_min, yearMax: year_max });
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.warn(`[${site.sourceId}] search error:`, err.message);
    }
    return { papers: [], total: 0 };
  }
}

/**
 * Look up one OJS article by its numeric id by fetching the landing page.
 * Returns null rather than a placeholder record when the fetch fails.
 */
export async function getOjsById(rawId, site, signal) {
  const artId = String(rawId).replace(new RegExp(`^${site.sourceId}:`), "");
  if (!/^\d+$/.test(artId)) return null;
  const url = `${site.baseUrl}/index.php/${site.defaultSlug || "index"}/article/view/${artId}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: withTimeout(signal, 12000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const meta = (name) => {
      const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "i");
      const m = html.match(re);
      return m ? stripHtml(m[1]) : null;
    };
    const metaAll = (name) => {
      const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "gi");
      return [...html.matchAll(re)].map((m) => stripHtml(m[1])).filter(Boolean);
    };

    const title = meta("citation_title") || meta("DC.Title");
    if (!title) return null;
    const pdfMeta = meta("citation_pdf_url");

    return {
      id: `${site.sourceId}:${artId}`,
      title,
      authors: metaAll("citation_author"),
      year: parseYear(meta("citation_publication_date") || meta("citation_date") || meta("DC.Date.issued")),
      doi: meta("citation_doi") || null,
      arxiv_id: null,
      abstract: meta("DC.Description") || null,
      citation_count: null,
      pdf_url: pdfMeta || null,
      url: resp.url || url,
      source: site.sourceId,
      venue: meta("citation_journal_title") || site.defaultVenue,
      volume: meta("citation_volume"),
      issue: meta("citation_issue"),
      pages: meta("citation_firstpage") && meta("citation_lastpage")
        ? `${meta("citation_firstpage")}-${meta("citation_lastpage")}`
        : meta("citation_firstpage"),
      publisher: site.publisher,
      type: "article",
      issn: meta("citation_issn") || site.issn || null,
      is_oa: true,
    };
  } catch {
    return null;
  }
}
