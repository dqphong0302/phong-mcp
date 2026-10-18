import type { Dict, Raw } from "./academic/types.ts";
import { fetch as undiciFetch, ProxyAgent, Agent, setGlobalDispatcher } from "undici";
import dns from "node:dns";
import { PROXY_URL } from "./config.ts";

const ipv4Agent = new Agent({
  connect: {
    lookup: (hostname, opts, cb) => dns.lookup(hostname, { ...opts, family: 4 }, cb),
  },
});
try {
  setGlobalDispatcher(ipv4Agent);
} catch {}

/**
 * Perform a fetch request that respects HTTPS/HTTP proxy settings using undici's ProxyAgent.
 * Falls back to undici's fetch or standard fetch if no proxy is configured.
 *
 * @param {string|URL} url Target URL
 * @param {object} options Fetch options
 * @returns {Promise<Response>}
 */
export async function proxyAwareFetch(url: Raw, options: Dict = {}) {
  const fetchOpts = { ...options };

  // Setup proxy if configured
  if (PROXY_URL) {
    fetchOpts.dispatcher = new ProxyAgent(PROXY_URL);
  } else if (!fetchOpts.dispatcher) {
    fetchOpts.dispatcher = ipv4Agent;
  }

  // Handle timeout via AbortSignal if timeout is provided as a number of milliseconds
  let timeoutTimer = null;
  if (typeof options.timeout === "number" && !options.signal) {
    const controller = new AbortController();
    fetchOpts.signal = controller.signal;
    timeoutTimer = setTimeout(() => {
      controller.abort();
    }, options.timeout);
    delete fetchOpts.timeout;
  }

  try {
    const resp = await undiciFetch(url, fetchOpts);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    return resp;
  } catch (err) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timeout: Target did not respond within ${options.timeout}ms.`);
    }
    throw err;
  }
}
