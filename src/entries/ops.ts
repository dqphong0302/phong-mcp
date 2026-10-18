#!/usr/bin/env node
/**
 * phong-ops — Local infrastructure & ops tools.
 * Tools: tts_generate_audio, asr_transcribe, server (ops fleet)
 * TRANSPORT=stdio|http  PORT=3115
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTtsTools } from "../tts/index.ts";
import { registerServerTool } from "../server/index.ts";

const NAME = "phong-ops";
const VERSION = "1.0.0";

function buildServer() {
  const s = new McpServer({ name: NAME, version: VERSION });
  registerTtsTools(s);
  registerServerTool(s);
  return makeToolSchemasPortable(s);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3115", 10);

  if (TRANSPORT === "http") {
    const { startHttpTransport } = await import("../transport-http-generic.ts");
    await startHttpTransport(NAME, buildServer, PORT);
  } else {
    const server = buildServer();
    await server.connect(new StdioServerTransport());
    console.error(`${NAME} v${VERSION} on stdio`);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
