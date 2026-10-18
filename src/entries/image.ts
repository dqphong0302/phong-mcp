#!/usr/bin/env node
/**
 * phong-image — Image generation & diagram rendering tools.
 * Tools: image_create_image, image_process_image,
 *        diagram_render, diagram_explain, diagram_paperbanana_generate
 * TRANSPORT=stdio|http  PORT=3111
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerImageTools } from "../image/index.ts";
import { registerDiagramTools } from "../diagram/index.ts";

const NAME = "phong-image";
const VERSION = "1.0.0";

function buildServer() {
  const s = new McpServer({ name: NAME, version: VERSION });
  registerImageTools(s);
  registerDiagramTools(s);
  return makeToolSchemasPortable(s);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3111", 10);

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
