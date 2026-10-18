/**
 * HTTP transport for phong-mcp (SDK 1.5+).
 *
 * Primary:  POST/GET/DELETE /mcp  — Streamable HTTP (MCP spec 2025-03-26)
 * Legacy:   GET /sse + POST /messages — SSE transport (backward-compat)
 * Health:   GET /health
 */
import type { Raw } from "./academic/types.ts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";

const NAME = "phong-mcp";
const VERSION = "1.4.0";

function setCorsAndCache(res: Raw) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

export async function startHttpTransport(port: Raw, createServer?: Raw) {
  // Loaded only when the caller brings no factory: server-factory.ts imports
  // every tool module (sharp, SSH ops, ...), which a curated gateway must not need.
  if (!createServer) createServer = (await import("./server-factory.ts")).createServer;
  const streamableSessions = new Map(); // sessionId → StreamableHTTPServerTransport
  const sseSessions = new Map();        // sessionId → { transport, server }

  const httpServer: Raw = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    setCorsAndCache(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let pathname = url.pathname;
    const prefix = pathname.startsWith(`/${NAME}`) ? `/${NAME}` : "";
    if (prefix) pathname = pathname.substring(prefix.length);

    // ── Health ─────────────────────────────────────────────────────────────
    if (pathname === "/health" || pathname === "" || pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        name: NAME,
        version: VERSION,
        streamableSessions: streamableSessions.size,
        sseSessions: sseSessions.size,
      }));
      return;
    }

    // ── Streamable HTTP: POST /mcp ─────────────────────────────────────────
    if (pathname === "/mcp" && req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"];
      let transport: Raw;

      if (sessionId && streamableSessions.has(sessionId)) {
        transport = streamableSessions.get(sessionId);
      } else if (!sessionId) {
        const mcp = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            streamableSessions.set(sid, transport);
            console.error(`[${NAME}] Streamable session: ${sid} (active: ${streamableSessions.size})`);
          },
        });
        transport.onclose = () => {
          const sid: Raw = transport.sessionId;
          if (sid) streamableSessions.delete(sid);
          console.error(`[${NAME}] Session closed: ${sid} (remaining: ${streamableSessions.size})`);
        };
        await mcp.connect(transport);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown session: ${sessionId}` }));
        return;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (e) {
        console.error(`[${NAME}] POST /mcp error:`, e);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
      return;
    }

    // ── Streamable HTTP: GET /mcp ──────────────────────────────────────────
    if (pathname === "/mcp" && req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"];
      if (!sessionId || !streamableSessions.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or unknown Mcp-Session-Id" }));
        return;
      }
      try {
        await streamableSessions.get(sessionId).handleRequest(req, res);
      } catch (e) {
        console.error(`[${NAME}] GET /mcp error:`, e);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
      return;
    }

    // ── Streamable HTTP: DELETE /mcp ───────────────────────────────────────
    if (pathname === "/mcp" && req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      if (sessionId && streamableSessions.has(sessionId)) {
        const t = streamableSessions.get(sessionId);
        streamableSessions.delete(sessionId);
        try { await t.close(); } catch (_) {}
        console.error(`[${NAME}] Session terminated: ${sessionId}`);
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Legacy SSE: GET /sse ───────────────────────────────────────────────
    if (pathname === "/sse" && req.method === "GET") {
      const mcp = createServer();
      const transport = new SSEServerTransport(`${prefix}/messages`, res);
      const sessionId = transport.sessionId;
      sseSessions.set(sessionId, { transport, server: mcp });
      console.error(`[${NAME}] Legacy SSE session: ${sessionId} (active: ${sseSessions.size})`);

      try {
        await mcp.connect(transport);
      } catch (e) {
        console.error(`[${NAME}] SSE connect error:`, e);
        sseSessions.delete(sessionId);
        return;
      }

      const keepalive = setInterval(() => {
        if (res.writable) {
          try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); }
        } else {
          clearInterval(keepalive);
        }
      }, 5000);

      req.on("close", async () => {
        clearInterval(keepalive);
        sseSessions.delete(sessionId);
        console.error(`[${NAME}] SSE closed: ${sessionId} (remaining: ${sseSessions.size})`);
        try { await transport.close(); } catch (_) {}
      });
      return;
    }

    // ── Legacy SSE: POST /messages ─────────────────────────────────────────
    if (pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing ?sessionId. Connect /sse first." }));
        return;
      }
      const session = sseSessions.get(sessionId);
      if (!session) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No active session: ${sessionId}` }));
        return;
      }
      try {
        await session.transport.handlePostMessage(req, res);
      } catch (e) {
        console.error(`[${NAME}] POST /messages error:`, e);
        res.writeHead(500); res.end();
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`[${NAME}] v${VERSION} on http://0.0.0.0:${port}`);
    console.error(`  Streamable HTTP: POST/GET/DELETE /mcp`);
    console.error(`  Legacy SSE:      GET /sse  POST /messages`);
    console.error(`  Health:          GET /health`);
  });
}
