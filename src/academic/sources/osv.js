/**
 * Google Open Source Vulnerabilities (OSV.dev) API source plugin.
 * Free, no API key required.
 * Docs: https://osv.dev/docs/
 *
 * Provides: Vulnerabilities across open source package ecosystems
 * (npm, PyPI, Go, Rust Crates, Maven, NuGet, Debian, Alpine, OSS-Fuzz).
 */

import { fromOsv } from "../formatter.js";

export const id = "osv";
export const name = "Google OSV (Open Source Vulnerabilities)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["security", "cybersecurity", "open_source", "supply_chain", "cve"];

const BASE_URL = "https://api.osv.dev/v1";

/**
 * Search OSV by vulnerability ID or package name.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10 } = opts;
  const cleanQuery = query.trim();

  // If user searched for a vulnerability ID directly (GHSA, CVE, PYSEC, RUSTSEC, GO-...)
  if (/^(GHSA|CVE|PYSEC|RUSTSEC|GO|OSV|BIT|MAL)-\w+/i.test(cleanQuery)) {
    const vuln = await getById(cleanQuery);
    return vuln ? { papers: [vuln], total: 1 } : { papers: [], total: 0 };
  }

  // Otherwise query across common open-source ecosystems
  const ecosystems = ["npm", "PyPI", "Go", "crates.io", "Maven", "NuGet"];
  const pkgName = cleanQuery.toLowerCase();

  try {
    const tasks = ecosystems.map(async (eco) => {
      try {
        const resp = await fetch(`${BASE_URL}/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            package: {
              name: pkgName,
              ecosystem: eco,
            },
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.vulns || [];
      } catch {
        return [];
      }
    });

    const batches = await Promise.all(tasks);
    const allVulns = batches.flat();

    // Deduplicate by vuln ID
    const seen = new Set();
    const uniqueVulns = [];
    for (const v of allVulns) {
      if (v?.id && !seen.has(v.id)) {
        seen.add(v.id);
        uniqueVulns.push(v);
      }
    }

    const papers = uniqueVulns.map(fromOsv);

    return {
      papers: papers.slice(0, limit),
      total: uniqueVulns.length,
    };
  } catch (err) {
    console.warn("[osv] search failed:", err.message);
    return { papers: [], total: 0 };
  }
}

/**
 * Get vulnerability by ID.
 *
 * @param {string} id
 * @param {Object} [_config]
 */
export async function getById(id, _config = {}) {
  const cleanId = id.replace(/^osv:/i, "").trim();
  if (!cleanId) return null;

  try {
    const url = `${BASE_URL}/vulns/${encodeURIComponent(cleanId)}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) return null;
    const vuln = await resp.json();
    return vuln && vuln.id ? fromOsv(vuln) : null;
  } catch {
    return null;
  }
}

export { search as searchOsv };
