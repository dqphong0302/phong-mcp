/**
 * Software Heritage Archive REST API source plugin.
 * Free, no API key required.
 * Docs: https://archive.softwareheritage.org/api/1/
 *
 * Provides: Software source code archive origins, historic commits, and persistent SWHIDs.
 */

import { fromSoftwareHeritage } from "../formatter.js";

export const id = "software_heritage";
export const name = "Software Heritage (Universal Code Archive)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["software", "open_source", "code_archive", "history_of_computing"];

const BASE_URL = "https://archive.softwareheritage.org/api/1";

/**
 * Search Software Heritage origins.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const cleanQuery = query.trim();

  try {
    const url = `${BASE_URL}/origin/search/${encodeURIComponent(cleanQuery)}/`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const origins = await resp.json();
    if (!Array.isArray(origins)) return { papers: [], total: 0 };

    const papers = origins.map(fromSoftwareHeritage);

    return {
      papers: papers.slice(0, limit),
      total: origins.length,
    };
  } catch (err) {
    console.warn("[software_heritage] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export { search as searchSoftwareHeritage };
