#!/usr/bin/env node
/**
 * home-server-mcp — HTTP entry point.
 * Same tool set as all.ts (stdio) but serves Streamable HTTP + legacy SSE.
 *
 * TRANSPORT=http (default) → HTTP on PORT (default 3001)
 * TRANSPORT=stdio          → stdio (fallback)
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server-factory.ts";

const PORT = parseInt(process.env.PORT || "3001", 10);
const TRANSPORT = process.env.TRANSPORT || "http";
const NAME = "home-server-mcp";
const VERSION = "1.4.0";

async function main() {
  if (TRANSPORT === "http") {
    const { startHttpTransport } = await import("../transport-http.ts");
    await startHttpTransport(PORT);
  } else {
    const server = createServer();
    server.server.name = NAME;
    await server.connect(new StdioServerTransport());
    console.error(`${NAME} v${VERSION} on stdio`);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
