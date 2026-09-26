/**
 * CISA Known Exploited Vulnerabilities (KEV) Catalog plugin.
 * Free, no API key required.
 * Docs: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 *
 * Provides: Authoritative source of vulnerabilities that have been exploited in the wild,
 * required remediation actions, and strict compliance due dates.
 */

import { fromCisaKev } from "../formatter.js";

export const id = "cisa_kev";
export const name = "CISA Known Exploited Vulnerabilities";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["security", "cybersecurity", "cisa", "active_threats", "ransomware"];

const KEV_FEED_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

// In-memory cache for the CISA KEV catalog (1 hour TTL)
let cachedKevData = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchKevCatalog() {
  const now = Date.now();
  if (cachedKevData && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedKevData;
  }

  try {
    const resp = await fetch(KEV_FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return cachedKevData || [];
    }

    const json = await resp.json();
    cachedKevData = json.vulnerabilities || [];
    lastFetchTime = now;
    return cachedKevData;
  } catch (err) {
    console.warn("[cisa_kev] fetch feed failed:", err.message);
    return cachedKevData || [];
  }
}

/**
 * Search CISA KEV catalog by keyword, CVE ID, vendor, or product.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, sort = "recency" } = opts;
  const items = await fetchKevCatalog();

  const queryLower = query.toLowerCase().trim();
  const keywords = queryLower.split(/\s+/).filter(Boolean);

  const matched = items.filter((item) => {
    const text = `${item.cveID || ""} ${item.vendorProject || ""} ${item.product || ""} ${item.vulnerabilityName || ""} ${item.shortDescription || ""} ${item.knownRansomwareCampaignUse || ""} ${item.requiredAction || ""}`.toLowerCase();
    return keywords.length > 0
      ? keywords.every((kw) => text.includes(kw)) || keywords.some((kw) => text.includes(kw))
      : true;
  });

  if (sort === "recency") {
    matched.sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
  }

  const papers = matched.map(fromCisaKev);

  return {
    papers: papers.slice(0, limit),
    total: matched.length,
  };
}

export async function getById(cveId, _config = {}) {
  const cleanId = cveId.replace(/^cisa-kev:/i, "").replace(/^cve:/i, "").trim().toUpperCase();
  const items = await fetchKevCatalog();
  const item = items.find((v) => v.cveID?.toUpperCase() === cleanId);
  return item ? fromCisaKev(item) : null;
}

export { search as searchCisaKev };
