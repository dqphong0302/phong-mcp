#!/usr/bin/env node
/**
 * phong-mcp-bridge — High-performance Streamable HTTP stdio bridge for Antigravity IDE.
 * 
 * Features:
 * - 0ms startup time (immediate stdio attachment).
 * - LAN auto-detection with robust 800ms timer and clean socket drainage: routes directly
 *   to the authenticated Home Server LAN gateway and seamlessly falls back to Cloudflare WAN
 *   (ai-proxy.phongdang.io.vn) when away from home.
 * - HTTP keep-alive connection pooling for sub-millisecond local requests.
 * - Transparent MCP session lifecycle and automatic session recovery.
 * - 10-minute per-request timeout for deep research and writing loops.
 */

import { errorCode, errorMessage } from "./academic/errors.ts";
import type { Raw } from "./academic/types.ts";
import readline from "node:readline";
import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { URL } from "node:url";

// Use the same auth/scoping boundary on LAN and WAN, not the backend port.
const LAN_HEALTH_URL = "http://10.10.10.230/phong-mcp/health";
const LAN_ENDPOINT = "http://10.10.10.230/phong-mcp/mcp";
const WAN_ENDPOINT = "https://ai-proxy.phongdang.io.vn/phong-mcp/mcp";

const apiKey = process.env.PHONG_MCP_API_KEY || process.env.RESEARCH_MCP_TOKEN || "";
if (!apiKey) {
  console.error('Bridge requires PHONG_MCP_API_KEY or RESEARCH_MCP_TOKEN; no embedded credential is available');
  process.exit(1);
}
const REQUEST_TIMEOUT_MS = 600_000; // 10 minutes for heavy LLM operations

// Keep-alive agents for high-throughput connection pooling
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// State
let selectedEndpoint = process.env.PHONG_MCP_URL || process.env.PHONG_MCP_SERVER_URL || null;
let endpointResolvingPromise: Raw = null;
let currentSessionId: Raw = null;
let sessionInitPromise: Raw = null;
let lastInitRequest: Raw = null;
const messageQueue: Raw = [];
let isProcessingQueue = false;
const inFlight = new Set();
const MAX_IN_FLIGHT = 8;

// ── 1. Endpoint Resolution ──────────────────────────────────────────────────
async function resolveEndpoint() {
  if (selectedEndpoint) return selectedEndpoint;
  if (endpointResolvingPromise) return endpointResolvingPromise;

  endpointResolvingPromise = new Promise((resolve) => {
    let settled = false;

    const finalize = (endpoint: Raw, msg: Raw) => {
      if (settled) return;
      settled = true;
      selectedEndpoint = endpoint;
      if (msg) console.error(msg);
      resolve(selectedEndpoint);
    };

    const req = http.get(LAN_HEALTH_URL, { agent: httpAgent, family: 4 }, (res) => {
      clearTimeout(timer);
      res.resume(); // Ensure response body is drained so socket is returned to agent pool
      if (res.statusCode === 200) {
        finalize(LAN_ENDPOINT, "[phong-mcp-bridge] Authenticated LAN gateway detected (10.10.10.230) — low latency mode enabled.");
      } else {
        finalize(WAN_ENDPOINT, `[phong-mcp-bridge] LAN health returned ${res.statusCode}, falling back to WAN.`);
      }
    });

    const timer = setTimeout(() => {
      req.destroy();
      finalize(WAN_ENDPOINT, "[phong-mcp-bridge] LAN probe timed out (>800ms), using Cloudflare WAN proxy.");
    }, 800);

    req.on("error", (err) => {
      clearTimeout(timer);
      finalize(WAN_ENDPOINT, `[phong-mcp-bridge] LAN unreachable (${err.message}), using Cloudflare WAN proxy.`);
    });
  });

  return endpointResolvingPromise;
}

// ── 2. HTTP POST Dispatcher ──────────────────────────────────────────────────
interface PostResult {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

function postJson(endpointUrl: Raw, payloadString: Raw, sessionId: Raw): Promise<PostResult> {
  return new Promise<PostResult>((resolve, reject) => {
    const parsed = new URL(endpointUrl);
    const isHttps = parsed.protocol === "https:";
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const payloadBuffer = Buffer.from(payloadString, "utf8");

    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": payloadBuffer.length,
      "User-Agent": "Antigravity-MCP-Bridge/1.0",
      "Accept": "application/json"
    };

    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: "POST",
      headers,
      agent,
      family: 4,
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Upstream response aborted; request outcome is unknown')));
      res.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyText
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(payloadBuffer);
    req.end();
  });
}

// ── 3. Session Helpers ───────────────────────────────────────────────────────
async function ensureSession(endpoint: Raw) {
  if (sessionInitPromise) return sessionInitPromise;
  if (currentSessionId) return currentSessionId;
  if (!lastInitRequest) return null;
  sessionInitPromise = (async () => {
      const initResp = await postJson(endpoint, lastInitRequest, null);
      if (initResp.statusCode === 200) {
        currentSessionId = initResp.headers['mcp-session-id'] || null;
        await postJson(endpoint, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), currentSessionId);
        return currentSessionId;
      }
      throw new Error(`Session initialization failed: HTTP ${initResp.statusCode}`);
  })();
  try {
    return await sessionInitPromise;
  } finally {
    sessionInitPromise = null;
  }
}

// ── 4. Stdio Message Processor ───────────────────────────────────────────────
async function processMessage(line: Raw) {
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(line);
  } catch {
    // If not valid JSON, ignore
    return;
  }

  const isNotification = parsedJson.id === undefined || parsedJson.id === null;
  const isInitialize = parsedJson.method === "initialize";

  if (isInitialize) {
    lastInitRequest = line;
    currentSessionId = null; // Always fresh session on initialize
  }

  let endpoint = await resolveEndpoint();

  // If we don't have a session yet for non-initialize requests, initialize first
  try {
    if (!isInitialize && !currentSessionId && lastInitRequest) await ensureSession(endpoint);
    const sessionIdToSend: Raw = isInitialize ? null : currentSessionId;
    let resp = await postJson(endpoint, line, sessionIdToSend);

    if (isInitialize && resp.statusCode === 200) currentSessionId = resp.headers['mcp-session-id'] || null;

    // Handle session expiration or invalid session (400 or 404)
    const sessionError = resp.statusCode === 404 ||
      (resp.statusCode === 400 && /(?:missing|invalid|unknown)\s+(?:mcp[- ]session[- ]id|session)/i.test(resp.body));
    if (sessionError && !isInitialize && lastInitRequest) {
      console.error(`[phong-mcp-bridge] Session expired or invalid (HTTP ${resp.statusCode}). Re-initializing...`);
      if (currentSessionId === sessionIdToSend) currentSessionId = null;
      await ensureSession(endpoint);
      // Session rejection precedes tool execution, so this replay is safe.
      resp = await postJson(endpoint, line, currentSessionId);
    }

    if (resp.statusCode === 200) {
      if (resp.body && resp.body.trim()) {
        process.stdout.write(resp.body.trim() + "\n");
      }
    } else if (resp.statusCode === 202) {
      // Notification acknowledged; do not write to stdout
    } else {
      console.error(`[phong-mcp-bridge] Upstream error (HTTP ${resp.statusCode}): ${resp.body}`);
      if (!isNotification) {
        const errObj = {
          jsonrpc: "2.0",
          id: parsedJson.id,
          error: {
            code: -32603,
            message: `Upstream HTTP ${resp.statusCode}: ${resp.body || "Internal Error"}`
          }
        };
        process.stdout.write(JSON.stringify(errObj) + "\n");
      }
    }
  } catch (err) {
    console.error(`[phong-mcp-bridge] Connection error to ${endpoint}: ${errorMessage(err)}`);

    // If LAN failed unexpectedly during execution, fall back to WAN and retry once
    const connectFailed = ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND'].includes(String(errorCode(err)));
    if (endpoint === LAN_ENDPOINT) selectedEndpoint = WAN_ENDPOINT;
    if (endpoint === LAN_ENDPOINT && connectFailed) {
      console.error("[phong-mcp-bridge] Retrying request via WAN fallback...");
      selectedEndpoint = WAN_ENDPOINT;
      try {
        if (!isInitialize && !currentSessionId && lastInitRequest) {
          await ensureSession(WAN_ENDPOINT);
        }
        const wanResp: Raw = await postJson(WAN_ENDPOINT, line, isInitialize ? null : currentSessionId);
        if (isInitialize && wanResp.statusCode === 200) currentSessionId = wanResp.headers['mcp-session-id'] || null;
        if (wanResp.statusCode === 200 && wanResp.body.trim()) {
          process.stdout.write(wanResp.body.trim() + "\n");
          return;
        } else if (wanResp.statusCode === 202) {
          return;
        }
      } catch (wanErr) {
        console.error("[phong-mcp-bridge] WAN fallback also failed:", errorMessage(wanErr));
      }
    }

    if (!isNotification) {
      const errObj = {
        jsonrpc: "2.0",
        id: parsedJson.id,
        error: {
          code: -32000,
          message: `Bridge transport failure: ${errorMessage(err)}`
        }
      };
      process.stdout.write(JSON.stringify(errObj) + "\n");
    }
  }
}

async function pumpQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const line: Raw = messageQueue.shift();
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    // Initialize and notifications establish session state before tool calls.
    if (message.method === "initialize" || message.id === undefined) {
      await Promise.allSettled([...inFlight]);
      await processMessage(line);
    } else {
      if (inFlight.size >= MAX_IN_FLIGHT) await Promise.race(inFlight);
      const pending = processMessage(line).finally(() => inFlight.delete(pending));
      inFlight.add(pending);
    }
  }

  isProcessingQueue = false;
}

// ── 5. Stdin Setup ───────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: null as unknown as NodeJS.WritableStream, // Avoid stdout pollution in stdio bridges
  terminal: false
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  messageQueue.push(trimmed);
  pumpQueue();
});

// Kick off endpoint probe eagerly in background
resolveEndpoint().catch(() => {});
