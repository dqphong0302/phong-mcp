/**
 * HTTP/SSE Transport for MCP server (Docker mode)
 * Exposes MCP over HTTP with Server-Sent Events for streaming.
 */

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";

export async function startHttpTransport(server, port) {
  let transport = null;

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "phong-mcp", version: "1.0.0" }));
      return;
    }

    // SSE endpoint — client connects here to receive events
    if (url.pathname === "/sse") {
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
      return;
    }

    // Messages endpoint — client sends messages here
    if (url.pathname === "/messages" && req.method === "POST") {
      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active SSE connection. Connect to /sse first." }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`phong-mcp (public) running on http://0.0.0.0:${port}`);
    console.error(`  SSE: http://0.0.0.0:${port}/sse`);
    console.error(`  Health: http://0.0.0.0:${port}/health`);
  });
}
