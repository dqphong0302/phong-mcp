#!/usr/bin/env node
/**
 * phong-content — Content & document transformation tools.
 * Tools: content_generator, distill, file_convert, code_review
 * TRANSPORT=stdio|http  PORT=3112
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContentGenTool } from "../content-gen/index.ts";
import { registerDistillTool } from "../distill/index.ts";
import { registerFileConvertTool } from "../file-convert/index.ts";
import { registerCodeReviewTool } from "../code-review/index.ts";

const NAME = "phong-content";
const VERSION = "1.0.0";

function buildServer() {
  const s = new McpServer({ name: NAME, version: VERSION });
  registerContentGenTool(s);
  registerDistillTool(s);
  registerFileConvertTool(s);
  registerCodeReviewTool(s);
  return makeToolSchemasPortable(s);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3112", 10);

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
