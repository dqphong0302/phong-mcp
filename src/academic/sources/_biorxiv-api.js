/**
 * Shared client for the bioRxiv/medRxiv API (api.biorxiv.org).
 *
 * The API has no search endpoint: it serves a date window, 100 records per
 * cursor page, and callers filter locally. Walking several pages per search is
 * therefore necessary — but it is also the reason this client exists rather
 * than a plain fetch in each adapter:
 *
 *  - Every page must go through the source rate limiter. The limiter wraps one
 *    `search()` call as a single scheduled unit, so a page loop inside that call
 *    fires all its requests back-to-back and spends the whole politeness budget
 *    at once. Passing a scheduler in restores the intended spacing per request.
 *  - The upstream signals refusal as **HTTP 200 with an empty body**, not 429.
 *    Treated naively that is indistinguishable from "no preprints matched", and
 *    the source silently disappears from results. It is reported here instead.
 *  - Pages are cached per window so two searches in a session do not refetch
 *    the same 500 records.
 */

import { cacheKey, cachedOrExecute, TTL } from "../cache.js";

const BASE = "https://api.biorxiv.org";

/**
 * Rate-limiter bucket for this host. Both collections live behind one server,
 * so they share one budget — and page requests must NOT be scheduled on the
 * per-source bucket, which the enclosing search() call is already occupying.
 */
export const BIORXIV_API_BUCKET = "biorxiv_api";
// The API serves 30 records per call and the cursor is a record offset, not a
// page number. (Its own documentation says 100 in one place and 30 in another;
// the live response reports 30 in `messages[0].count`.)
const PAGE_SIZE = 30;
const PAGE_TIMEOUT_MS = 20000;

/** Pages of a window are cached for a session; the window itself moves slowly. */
const PAGE_TTL = TTL.SEARCH;

/**
 * Thrown when the API answers but hands back nothing — its way of refusing.
 * Named so callers can tell "upstream unavailable" from "no matches".
 */
export class BiorxivUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "BiorxivUnavailableError";
    this.unavailable = true;
  }
}

/**
 * Fetch one cursor page.
 *
 * @param {string} server "biorxiv" | "medrxiv"
 * @param {string} startDate
 * @param {string} endDate
 * @param {number} cursor
 * @param {AbortSignal} [signal]
 * @returns {Promise<{collection: Object[], empty: boolean}>}
 */
async function fetchPage(server, startDate, endDate, cursor, signal) {
  const url = `${BASE}/details/${server}/${startDate}/${endDate}/${cursor}/json`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: signal || AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });

  if (!resp.ok) throw new BiorxivUnavailableError(`HTTP ${resp.status}`);

  const body = await resp.text();
  // A 200 carrying no bytes is the API declining to serve, not an empty result
  // set: a real empty window still returns a JSON envelope with `messages`.
  if (!body.trim()) {
    throw new BiorxivUnavailableError("HTTP 200 with an empty body — API declined the request");
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new BiorxivUnavailableError("response was not JSON");
  }
  const total = parseInt(data?.messages?.[0]?.total, 10);
  return {
    collection: data.collection || [],
    total: Number.isFinite(total) ? total : null,
  };
}

/**
 * Walk cursor pages of a date window, stopping as soon as `enough` is satisfied.
 *
 * @param {Object} opts
 * @param {string} opts.server
 * @param {string} opts.startDate
 * @param {string} opts.endDate
 * @param {number} [opts.maxPages=3]
 * @param {(records: Object[]) => boolean} [opts.enough] called after each page
 * @param {(fn: Function) => Promise<any>} [opts.schedule] rate-limiter wrapper
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object[]>}
 * @throws {BiorxivUnavailableError} when the first page is refused
 */
export async function fetchWindow({
  server,
  startDate,
  endDate,
  maxPages = 3,
  enough,
  schedule,
  signal,
}) {
  const run = schedule || ((fn) => fn());
  const collected = [];
  let requests = 0;

  const readPage = async (cursor) => {
    const key = cacheKey("biorxiv_page", { server, startDate, endDate, cursor });
    const { data } = await cachedOrExecute(key, PAGE_TTL, () =>
      run(() => fetchPage(server, startDate, endDate, cursor, signal))
    );
    return data;
  };

  // The first call doubles as the total-count probe: `messages[0].total` is the
  // only way to find the end of the window.
  let first;
  try {
    first = await readPage(0);
  } catch (err) {
    // Refused on the very first page: the caller must be able to say "source
    // unavailable" rather than report zero matches.
    throw err;
  }
  requests++;
  collected.push(...first.collection);
  if (enough && enough(collected)) return collected;

  const total = first.total;
  if (!total || total <= PAGE_SIZE) return collected;

  // Records come back oldest-first within the window. Reading forward from the
  // start means a query filtered to "since 2022" only ever sees January 2022 —
  // 90 records out of 74,000 — and never the recent preprints that are the
  // whole reason to search a preprint server. So walk in from the newest end.
  for (let k = 0; requests < maxPages; k++) {
    const cursor = total - PAGE_SIZE * (k + 1);
    if (cursor <= 0) break;

    let page;
    try {
      page = await readPage(cursor);
    } catch {
      break; // partial window is still usable
    }
    requests++;
    collected.push(...page.collection);
    if (page.collection.length === 0) break;
    if (enough && enough(collected)) break;
  }

  return collected;
}

export default { fetchWindow, BiorxivUnavailableError, BIORXIV_API_BUCKET };
