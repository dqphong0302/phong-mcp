/**
 * FRED — Federal Reserve Bank of St. Louis economic time series (~800k
 * series: GDP, CPI, rates, trade, including many country-level series for
 * Vietnam). Returns series metadata as records, not papers — use it to find
 * the data behind an economic claim.
 * Free API key: https://fredaccount.stlouisfed.org/apikeys
 * Docs: https://fred.stlouisfed.org/docs/api/fred/
 */

import { withTimeout } from "./_ojs.js";

export const id = "fred";
export const name = "FRED (Federal Reserve economic time series)";
export const requiresKey = true;
export const keyEnvVar = "FRED_API_KEY";
export const domains = ["economics", "finance", "statistics", "datasets"];

const API = "https://api.stlouisfed.org/fred/series/search";

export async function search(query, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;
  const key = config.fredApiKey || process.env.FRED_API_KEY;
  if (!key) return { papers: [], total: 0 };

  const params = new URLSearchParams({
    search_text: query,
    api_key: key,
    file_type: "json",
    limit: String(Math.min(limit, 100)),
    order_by: "popularity",
    sort_order: "desc",
  });

  try {
    const resp = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: withTimeout(signal, 20000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();

    const papers = [];
    for (const s of data?.seriess || []) {
      if (papers.length >= limit) break;
      const year = s.observation_end ? parseInt(String(s.observation_end).slice(0, 4), 10) : null;
      if (year != null) {
        if (year_min && year < year_min) continue;
        if (year_max && year > year_max) continue;
      }
      papers.push({
        id: `fred:${s.id}`,
        title: s.title || "",
        authors: [],
        year: Number.isFinite(year) ? year : null,
        doi: null,
        arxiv_id: null,
        abstract: s.notes || null,
        citation_count: s.popularity ?? null,
        pdf_url: null,
        url: `https://fred.stlouisfed.org/series/${s.id}`,
        source: "fred",
        venue: [s.frequency, s.units, s.seasonal_adjustment_short].filter(Boolean).join(", ") || "FRED",
        volume: null,
        issue: null,
        pages: null,
        publisher: "Federal Reserve Bank of St. Louis",
        type: "dataset",
        issn: null,
        is_oa: true,
        observation_range: s.observation_start && s.observation_end ? `${s.observation_start} → ${s.observation_end}` : null,
      });
    }

    return { papers, total: data?.count ?? papers.length };
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") console.warn("[fred] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchFred };
