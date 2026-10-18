#!/usr/bin/env node
/**
 * phong-academic — Academic search & consensus tools.
 * Tools: academic_search, academic_cite, academic_get_paper, academic_batch_format,
 *        academic_batch_download, academic_extract, academic_evidence_check,
 *        academic_cache_stats, consensus_search_papers, consensus_deep_search_papers
 * TRANSPORT=stdio|http  PORT=3110
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAcademicTools } from "../academic/index.ts";
import { registerConsensusTools } from "../consensus/index.ts";

const NAME = "phong-academic";
const VERSION = "1.0.0";

function buildServer() {
  const s = new McpServer({ name: NAME, version: VERSION });
  registerAcademicTools(s);
  registerConsensusTools(s);
  return makeToolSchemasPortable(s);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3110", 10);

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
