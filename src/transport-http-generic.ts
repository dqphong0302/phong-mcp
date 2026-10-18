/**
 * Generic HTTP/SSE Transport for any MCP server.
 * Reusable across split phong-* entries.
 *
 * Usage:
 *   import { startHttpTransport } from "../transport-http-generic.ts";
 *   await startHttpTransport("phong-academic", () => buildServer(), 3110);
 */

import type { Raw } from "./academic/types.ts";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";

export async function startHttpTransport(name: Raw, factory: Raw, port: Raw) {
  const sessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Allow optional path prefix matching server name (e.g. /phong-academic/sse)
    const expectedPrefix = `/${name}`;
    let prefix = "";
    let pathname = url.pathname;
    if (pathname.startsWith(expectedPrefix)) {
      prefix = expectedPrefix;
      pathname = pathname.substring(expectedPrefix.length);
    }

    if (pathname === "/health" || pathname === "") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        name,
        activeSessions: sessions.size,
      }));
      return;
    }

    if (pathname === "/sse") {
      const server = factory();
      const transport = new SSEServerTransport(`${prefix}/messages`, res);
      const sessionId = transport.sessionId;
      console.error(`[${name}] New SSE session: ${sessionId} (active: ${sessions.size + 1})`);
      sessions.set(sessionId, { transport, server });

      try {
        await server.connect(transport);
      } catch (e) {
        console.error(`[${name}] Connect error ${sessionId}:`, e);
        sessions.delete(sessionId);
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
        sessions.delete(sessionId);
        console.error(`[${name}] Session closed: ${sessionId} (remaining: ${sessions.size})`);
        try { await transport.close(); } catch (_) {}
      });
      return;
    }

    if (pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing ?sessionId. Connect /sse first." }));
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No active session: ${sessionId}` }));
        return;
      }
      try {
        await session.transport.handlePostMessage(req, res);
      } catch (e) {
        console.error(`[${name}] POST error:`, e);
        res.writeHead(500); res.end();
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`${name} running on http://0.0.0.0:${port}`);
    console.error(`  SSE:    http://0.0.0.0:${port}/sse`);
    console.error(`  Health: http://0.0.0.0:${port}/health`);
  });
}
