/**
 * medRxiv source plugin.
 * Free, no API key required.
 * Docs: https://api.biorxiv.org/
 *
 * Dedicated server plugin for medical & clinical preprints:
 * Clinical Medicine, Health Informatics, Psychiatry, Epidemiology, Infectious Disease.
 */

import { fromBiorxiv } from "../formatter.js";
import { filterByRelevance } from "./_relevance.js";
import { fetchWindow, BiorxivUnavailableError, BIORXIV_API_BUCKET } from "./_biorxiv-api.js";
import { searchPreprints } from "./_preprint-search.js";
import { sourceRateLimiter } from "../rate-limiter.js";

export const id = "medrxiv";
export const name = "medRxiv (Clinical Preprints)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "clinical", "epidemiology", "psychiatry", "public_health"];

const BASE = "https://api.biorxiv.org";

/** Cursor pages (100 records each) to scan at most; the walk stops early
 *  once enough matches are found. */
const PAGES_TO_SCAN = 3;

function getDateRange(days = 365) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

/**
 * Search medRxiv clinical preprints.
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  // Keyword queries go to Europe PMC, which indexes medRxiv and supports real
  // field search. The date-window API below cannot answer them: it serves 30
  // records per call in date order, so matching a query against a 74,000-record
  // corpus would mean downloading most of it.
  if (query && sort !== "recency") {
    try {
      const hit = await searchPreprints(query, {
        publisher: "medRxiv",
        limit,
        year_min,
        year_max,
        signal: opts.signal,
      });
      if (hit.papers.length) return hit;
    } catch (err) {
      console.warn("[medrxiv] preprint index unavailable, falling back to the date window:", err.message);
    }
  }

  let startDate, endDate;
  if (year_min || year_max) {
    startDate = `${year_min || 2020}-01-01`;
    endDate = `${year_max || new Date().getFullYear()}-12-31`;
  } else {
    const range = getDateRange(240);
    startDate = range.start;
    endDate = range.end;
  }

  try {
    // No search endpoint upstream — only a date window, paged. Each page is
    // scheduled through this source's rate limiter so the page loop cannot
    // spend the whole politeness budget in one burst, and the walk stops as
    // soon as enough matches have been found.
    const collection = await fetchWindow({
      server: "medrxiv",
      startDate,
      endDate,
      maxPages: PAGES_TO_SCAN,
      signal: opts.signal,
      schedule: (fn) => sourceRateLimiter.schedule(BIORXIV_API_BUCKET, fn, opts.signal),
      enough: (records) =>
        filterByRelevance(records, query, {
          getTitle: (p) => p.title || "",
          getText: (p) => `${p.title || ""} ${p.abstract || ""}`,
        }).length >= limit,
    });

    if (collection.length === 0) return { papers: [], total: 0 };

    // Relevance filter, not an any-word match: requiring most of the query's
    // content terms is what keeps unrelated preprints from the same date window
    // out of the result set.
    const matched = filterByRelevance(collection, query, {
      getTitle: (p) => p.title || "",
      getText: (p) => `${p.title || ""} ${p.abstract || ""}`,
    });

    const papers = matched.map((p) => fromBiorxiv(p, "medrxiv"));

    // filterByRelevance already ordered by match quality — only re-sort when
    // the caller explicitly asked for recency.
    if (sort === "recency") {
      papers.sort((a, b) => (b.year || 0) - (a.year || 0));
    }

    return {
      papers: papers.slice(0, limit),
      total: matched.length,
    };
  } catch (err) {
    // An unavailable upstream must surface as such. Returning an empty result
    // set would read as "no medRxiv preprints matched", which is what hid this
    // outage in the first place.
    if (err instanceof BiorxivUnavailableError) {
      console.warn(`[medrxiv] upstream unavailable: ${err.message}`);
      return { papers: [], total: 0, unavailable: true, reason: err.message };
    }
    console.warn("[medrxiv] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(doi, _config = {}) {
  if (!doi.startsWith("10.1101/")) return null;
  try {
    const resp = await fetch(`${BASE}/details/medrxiv/${encodeURIComponent(doi)}/na/json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const paper = data.collection?.[0];
    return paper ? fromBiorxiv(paper, "medrxiv") : null;
  } catch {
    return null;
  }
}

export { search as searchMedrxiv };
