/**
 * bioRxiv / medRxiv source plugin.
 * Free, no API key required.
 * Docs: https://api.biorxiv.org/
 *
 * Note: bioRxiv API does NOT have a keyword search endpoint.
 * We fetch recent papers and filter by keyword in title/abstract.
 * For broader coverage, we fetch a larger date window.
 *
 * bioRxiv: Biology, Neuroscience, Genetics, Ecology, Bioinformatics
 * medRxiv: Clinical Medicine, Health Informatics, Psychiatry, Epidemiology
 */

import { fromBiorxiv } from "../formatter.js";
import { filterByRelevance } from "./_relevance.js";
import { fetchWindow, BiorxivUnavailableError, BIORXIV_API_BUCKET } from "./_biorxiv-api.js";
import { searchPreprints } from "./_preprint-search.js";
import { sourceRateLimiter } from "../rate-limiter.js";

export const id = "biorxiv";
export const name = "bioRxiv / medRxiv";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["bio", "medicine", "neuroscience", "genetics", "epidemiology"];

const BASE = "https://api.biorxiv.org";

/** Cursor pages (100 records each) to scan at most per server; the walk
 *  stops early once enough matches are found. */
const PAGES_TO_SCAN = 3;

/**
 * Get date range string: past N days up to today.
 */
function getDateRange(days = 365) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

/**
 * Search bioRxiv + medRxiv by fetching recent papers and filtering by keyword.
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;

  // Determine date range — use year filter if provided, else recent 6 months
  let startDate, endDate;
  if (year_min || year_max) {
    startDate = `${year_min || 2020}-01-01`;
    endDate = `${year_max || new Date().getFullYear()}-12-31`;
  } else {
    const range = getDateRange(180);
    startDate = range.start;
    endDate = range.end;
  }

  const servers = ["biorxiv", "medrxiv"];
  const perServer = Math.min(limit * 3, 60);

  // Keyword queries go to Europe PMC, which indexes both servers and supports
  // real field search. The date-window API cannot answer them — see medrxiv.js.
  if (query && sort !== "recency") {
    const indexed = await Promise.all(
      [["biorxiv", "bioRxiv"], ["medrxiv", "medRxiv"]].map(async ([, publisher]) => {
        try {
          const hit = await searchPreprints(query, {
            publisher, limit: perServer, year_min, year_max, signal: opts.signal,
          });
          return hit.papers;
        } catch {
          return null; // fall through to the date-window scan below
        }
      })
    );
    if (indexed.some((x) => x?.length)) {
      const papers = indexed.flat().filter(Boolean);
      return { papers: papers.slice(0, limit), total: papers.length };
    }
  }

  const unavailable = [];
  const relevant = (records) =>
    filterByRelevance(records, query, {
      getTitle: (p) => p.title || "",
      getText: (p) => `${p.title || ""} ${p.abstract || ""}`,
    });

  const tasks = servers.map(async (srv) => {
    try {
      // No search endpoint upstream — only a date window, paged. Each page goes
      // through that server's rate limiter, so hitting two servers cannot fire
      // ten unspaced requests at one host, and the walk stops early once enough
      // matches are in hand.
      const collection = await fetchWindow({
        server: srv,
        startDate,
        endDate,
        maxPages: PAGES_TO_SCAN,
        signal: opts.signal,
        schedule: (fn) => sourceRateLimiter.schedule(BIORXIV_API_BUCKET, fn, opts.signal),
        enough: (records) => relevant(records).length >= perServer,
      });

      // Relevance filter rather than an any-word match: a preprint that merely
      // shares one common word with the query is noise, not a result.
      return relevant(collection).slice(0, perServer).map((p) => fromBiorxiv(p, srv));
    } catch (e) {
      if (e instanceof BiorxivUnavailableError) {
        console.warn(`[biorxiv] ${srv} upstream unavailable: ${e.message}`);
        unavailable.push(srv);
        return [];
      }
      console.warn(`[biorxiv] ${srv} error:`, e.message);
      return [];
    }
  });

  const batches = await Promise.all(tasks);
  let merged = batches.flat();

  // Each server's batch arrived ordered by match quality; only override that
  // when the caller explicitly asked for recency.
  if (sort === "recency") {
    merged.sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  return {
    papers: merged.slice(0, limit),
    total: merged.length,
    // Both servers refused: say so rather than let the caller read this as
    // "no preprints matched".
    ...(unavailable.length === servers.length
      ? { unavailable: true, reason: `api.biorxiv.org declined (${unavailable.join(", ")})` }
      : {}),
  };
}

export async function getById(doi, _config = {}) {
  if (!doi.startsWith("10.1101/")) return null;
  try {
    for (const srv of ["biorxiv", "medrxiv"]) {
      const resp = await fetch(`${BASE}/details/${srv}/${encodeURIComponent(doi)}/na/json`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const paper = data.collection?.[0];
      if (paper) return fromBiorxiv(paper, srv);
    }
    return null;
  } catch {
    return null;
  }
}

export { search as searchBiorxiv };
