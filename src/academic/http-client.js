/**
 * Smart HTTP Client with Automatic Rotating Proxy & Fallback.
 *
 * Features:
 * 1. Automatically utilizes 1-minute Rotating Proxy (`FOREIGN_PROXY_URL` / `ROTATING_PROXY_URL`).
 * 2. Smart Hybrid Routing:
 *    - Vietnam Domestic Journals (VJOL, VAST, HUST, VNU, UMP, NASATI) -> Direct fetch (Zero-proxy latency).
 *    - International Academic APIs (NCBI, OpenAlex, Semantic Scholar, Crossref, etc.) -> Rotating Proxy (Zero IP ban).
 * 3. Graceful Auto-Fallback: If proxy encounters a network glitch, transparently falls back to direct connection.
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";

// Domestic Vietnam journal identifiers
export const DOMESTIC_VN_SOURCES = new Set([
  "vjol",
  "vast",
  "jst_hust",
  "vnu_js",
  "vista_nasati",
  "tapchi_yhoc_tphcm",
  "tapchi_nghiencuuyhoc",
  "medpharmres",
]);

let _proxyAgent = null;
let _proxyInitialized = false;

function buildProxyAgent() {
  if (_proxyInitialized) return _proxyAgent;
  _proxyInitialized = true;

  const rawProxy =
    process.env.FOREIGN_PROXY_URL ||
    process.env.ROTATING_PROXY_URL ||
    process.env.ACADEMIC_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;

  if (!rawProxy) {
    return null;
  }

  try {
    const parsed = new URL(rawProxy);
    const uri = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? 443 : 80)}`;
    
    let token = null;
    if (parsed.username || parsed.password) {
      const user = decodeURIComponent(parsed.username || "");
      const pass = decodeURIComponent(parsed.password || "");
      token = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    }

    _proxyAgent = new ProxyAgent({
      uri,
      token: token || undefined,
      connect: { timeout: 15000 },
    });

    console.info(`[Academic HttpClient] Rotating Proxy Agent initialized -> ${parsed.hostname}:${parsed.port}`);
    return _proxyAgent;
  } catch (err) {
    console.warn(`[Academic HttpClient] Failed to initialize proxy (${rawProxy}):`, err.message);
    return null;
  }
}

/**
 * Intelligent fetch wrapper that routes through rotating proxy for international sources
 * and direct connection for domestic Vietnam sources, with automatic failover.
 *
 * @param {string|URL} url
 * @param {Object} [options]
 * @param {string} [sourceId] - optional source identifier for smart routing
 * @returns {Promise<Response>}
 */
export async function smartFetch(url, options = {}, sourceId = null) {
  const isDomestic = sourceId ? DOMESTIC_VN_SOURCES.has(sourceId) : false;
  const agent = isDomestic ? null : buildProxyAgent();

  if (!agent) {
    return fetch(url, options);
  }

  try {
    // Route via Undici ProxyAgent
    return await undiciFetch(url, {
      ...options,
      dispatcher: agent,
    });
  } catch (proxyErr) {
    // Transparent failover to direct fetch if proxy has a temporary connection glitch
    console.warn(`[Academic HttpClient] Proxy request failed for ${sourceId || "external"} (${proxyErr.message}) -> Falling back to direct connection.`);
    return fetch(url, options);
  }
}

export { buildProxyAgent as getProxyAgent };
