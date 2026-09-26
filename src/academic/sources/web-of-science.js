/**
 * Web of Science Starter API source plugin.
 * Free tier: 50 req/day. Institutional: 5000 req/day.
 * Register: https://developer.clarivate.com/
 * Docs: https://developer.clarivate.com/apis/wos-starter
 *
 * Coverage: 21,000+ peer-reviewed journals, Impact Factor source,
 * historical depth back to 1900, curated quality selection.
 */

import { fromWebOfScience } from "../formatter.js";

export const id = "web_of_science";
export const name = "Web of Science";
export const requiresKey = true;
export const keyEnvVar = "WOS_API_KEY";
export const domains = ["general", "cs", "bio", "medicine", "chemistry", "physics", "humanities"];

const BASE = "https://api.clarivate.com/apis/wos-starter/v1";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, sort = "relevance" } = opts;
  const apiKey = config.wosApiKey;
  if (!apiKey) throw new Error("WOS_API_KEY not set. Register free at developer.clarivate.com");

  // WoS query syntax: TS= (topic/title/abstract/keywords)
  let q = `TS=(${query})`;
  if (year_min || year_max) {
    const py = `PY=(${year_min || 1900}-${year_max || new Date().getFullYear()})`;
    q += ` AND ${py}`;
  }

  // Sort mapping
  const sortMap = { relevance: "RS", citations: "TC", recency: "PD" };

  const url = new URL(`${BASE}/documents`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  url.searchParams.set("page", "1");
  url.searchParams.set("sortField", sortMap[sort] || "RS");
  url.searchParams.set("sortOrder", "D"); // descending

  const resp = await fetch(url, {
    headers: {
      "X-ApiKey": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`Web of Science HTTP ${resp.status}: ${msg.slice(0, 200)}`);
  }

  const data = await resp.json();
  const hits = data.hits || [];
  const total = data.metadata?.total ?? hits.length;

  return {
    papers: hits.map(fromWebOfScience),
    total,
  };
}

export async function getById(uid, config = {}) {
  // WoS UID format: WOS:000123456789012
  const apiKey = config.wosApiKey;
  if (!apiKey) return null;
  const id = uid.startsWith("WOS:") ? uid : `WOS:${uid}`;
  const resp = await fetch(`${BASE}/documents/${encodeURIComponent(id)}`, {
    headers: { "X-ApiKey": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data ? fromWebOfScience(data) : null;
}

export { search as searchWebOfScience };
