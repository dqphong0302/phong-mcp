/**
 * Landing-page metadata enrichment.
 *
 * Several sources can only give a title and a link at search time — the OJS
 * portals (VJOL, VAST, JST, and the whole INASP "Journals Online" family),
 * VISTA, Tạp chí Y học TP.HCM, OATD. Their *search result* pages carry no
 * abstract and no DOI; the *article* page does, in the standard Highwire
 * Press / Dublin Core meta tags that OJS, DSpace and most publishers emit:
 *
 *   <meta name="citation_doi" content="10.xxxx/yyy">
 *   <meta name="citation_abstract" content="...">        (or DC.Description)
 *   <meta name="citation_author" content="Nguyễn Văn A">
 *
 * So instead of writing a bespoke scraper per source, this fetches the landing
 * page once and fills ONLY the fields that are still empty. It never
 * overwrites a value the source already provided, and never invents one.
 */

import { stripHtml, withTimeout } from "./sources/_ojs.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)";

function metaAll(html, names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*?content=["']([^"']*)["']` +
      `|<meta[^>]+content=["']([^"']*)["'][^>]*?(?:name|property)=["']${name}["']`,
      "gi"
    );
    for (const m of html.matchAll(re)) {
      const v = stripHtml(m[1] ?? m[2] ?? "");
      if (v) out.push(v);
    }
  }
  return out;
}

const meta1 = (html, names) => metaAll(html, names)[0] || null;

const cleanDoi = (d) =>
  d ? String(d).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim() : null;

/**
 * Read citation metadata from one article landing page.
 * @returns {Promise<Object|null>} only the fields actually found
 */
export async function fetchCitationMeta(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: withTimeout(opts.signal, opts.timeoutMs ?? 10000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers?.get?.("content-type") || "";
    if (ct && !/html|xml/i.test(ct)) return null;

    const html = (await resp.text()).slice(0, 400000);

    const doi = cleanDoi(meta1(html, ["citation_doi", "DC.Identifier.DOI", "dc.identifier.doi"]));
    const abstract =
      meta1(html, ["citation_abstract", "DC.Description", "dc.description", "description", "og:description"]);
    const authors = metaAll(html, ["citation_author", "DC.Creator", "dc.creator"]);
    const yearRaw = meta1(html, ["citation_publication_date", "citation_date", "DC.Date.issued", "citation_year"]);
    const year = yearRaw ? parseInt(String(yearRaw).match(/\b(19|20)\d{2}\b/)?.[0] ?? "", 10) : NaN;

    const found = {};
    if (doi && /^10\.\d{4,}\//.test(doi)) found.doi = doi;
    // A one-line og:description is usually boilerplate, not an abstract.
    if (abstract && abstract.length > 80) found.abstract = abstract;
    if (authors.length) found.authors = authors;
    if (Number.isFinite(year)) found.year = year;

    const title = meta1(html, ["citation_title", "DC.Title"]);
    if (title) found.title = title;
    const venue = meta1(html, ["citation_journal_title", "citation_conference_title"]);
    if (venue) found.venue = venue;
    const issn = meta1(html, ["citation_issn"]);
    if (issn) found.issn = issn;
    const vol = meta1(html, ["citation_volume"]);
    if (vol) found.volume = vol;
    const iss = meta1(html, ["citation_issue"]);
    if (iss) found.issue = iss;
    const fp = meta1(html, ["citation_firstpage"]);
    const lp = meta1(html, ["citation_lastpage"]);
    if (fp) found.pages = lp ? `${fp}-${lp}` : fp;
    const pdf = meta1(html, ["citation_pdf_url"]);
    if (pdf) found.pdf_url = pdf;

    return Object.keys(found).length ? found : null;
  } catch {
    return null;
  }
}

/**
 * Fill missing abstract / DOI / authors on papers that have a landing page.
 *
 * Mutates the papers in place and returns how many were improved. Only papers
 * that are actually missing an abstract are fetched, newest-ranked first, and
 * the whole pass is bounded by `timeoutMs` so search latency stays predictable.
 *
 * @param {Array} papers
 * @param {{limit?: number, timeoutMs?: number, signal?: AbortSignal}} opts
 * @returns {Promise<number>} number of papers enriched
 */
export async function enrichFromLandingPages(papers, opts = {}) {
  const { limit = 8, timeoutMs = 7000, signal } = opts;

  const targets = papers
    .filter((p) => p && p.url && !p.abstract)
    .slice(0, limit);
  if (!targets.length) return 0;

  let improved = 0;
  const work = Promise.all(
    targets.map(async (p) => {
      const meta = await fetchCitationMeta(p.url, { signal, timeoutMs: Math.min(timeoutMs, 9000) });
      if (!meta) return;
      let touched = false;

      // Fill only what is missing — the source's own values always win.
      if (!p.abstract && meta.abstract) { p.abstract = meta.abstract; touched = true; }
      if (!p.doi && meta.doi) {
        p.doi = meta.doi;
        // Promote the canonical id too, so the record dedupes against the same
        // paper coming from a DOI-aware source (OpenAlex, Crossref, ...).
        if (typeof p.id === "string" && !p.id.startsWith("doi:")) p.id = `doi:${meta.doi}`;
        touched = true;
      }
      if ((!p.authors || p.authors.length === 0) && meta.authors) { p.authors = meta.authors; touched = true; }
      if (p.year == null && meta.year != null) { p.year = meta.year; touched = true; }
      if (!p.venue && meta.venue) p.venue = meta.venue;
      if (!p.issn && meta.issn) p.issn = meta.issn;
      if (!p.volume && meta.volume) p.volume = meta.volume;
      if (!p.issue && meta.issue) p.issue = meta.issue;
      if (!p.pages && meta.pages) p.pages = meta.pages;
      if (!p.pdf_url && meta.pdf_url) { p.pdf_url = meta.pdf_url; p.is_oa = true; }

      if (touched) improved++;
    })
  );

  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
  return improved;
}
