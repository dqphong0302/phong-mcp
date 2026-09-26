/**
 * DBLP source plugin. CS bibliography, free, no key.
 * Docs: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
 */
import { fromDBLP } from "../formatter.js";

export const id = "dblp";
export const name = "DBLP";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["cs"];

const BASE = "https://dblp.org/search/publ/api";

const UA = `academic-search-mcp/2.0 (+mailto:${process.env.UNPAYWALL_EMAIL || "unset"})`;

/**
 * dblp serves "429 Too Many Requests" as an HTML page carrying HTTP 200. Parsed
 * as JSON that surfaces as `Unexpected token '<'`, which reads like a bug in
 * this adapter rather than as the throttling it is.
 */
function throttleMessage(body) {
  if (!body.trimStart().startsWith("<")) return null;

  // dblp also answers with a bot-check interstitial. That is an access control,
  // not a transient error: it is reported to the caller, never worked around.
  if (/making sure you|not a robot|captcha|verify you are human/i.test(body)) {
    return "dblp served a bot-check page — the JSON API is not reachable without completing it";
  }

  const m = body.match(/\b(429|503)\b[^<]{0,60}|Too Many Requests|Service Unavailable/i);
  return m
    ? `dblp responded with an HTML notice: ${m[0].trim().slice(0, 60)}`
    : "dblp returned HTML instead of JSON";
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max } = opts;
  const params = new URLSearchParams({ q: query, format: "json", h: String(Math.min(limit, 1000)) });
  const resp = await fetch(`${BASE}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`DBLP HTTP ${resp.status}`);

  const body = await resp.text();
  const throttled = throttleMessage(body);
  if (throttled) return { papers: [], total: 0, unavailable: true, reason: throttled };

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { papers: [], total: 0, unavailable: true, reason: "dblp response was not JSON" };
  }
  let papers = (data.result?.hits?.hit || []).map((h) => fromDBLP(h.info)).filter(Boolean);
  if (year_min) papers = papers.filter((p) => !p.year || p.year >= year_min);
  if (year_max) papers = papers.filter((p) => !p.year || p.year <= year_max);
  return { papers, total: parseInt(data.result?.hits?.["@total"], 10) || 0 };
}

export { search as searchDBLP };
