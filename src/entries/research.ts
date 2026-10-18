#!/usr/bin/env node
/**
 * phong-research — LLM-backed research tools.
 * Tools: perplexity_ask, perplexity_research, perplexity_reason, perplexity_search,
 *        medical_search_academic, medical_ask_openevidence
 * TRANSPORT=stdio|http  PORT=3114
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerPerplexityTools } from "../perplexity/index.ts";
import { registerMedicalTools } from "../medical/index.ts";
import { registerAcademicTools } from "../academic/index.ts";
import { registerConsensusTools } from "../consensus/index.ts";

const NAME = "phong-research";
const VERSION = "1.0.0";

function buildServer() {
  const s = new McpServer({ name: NAME, version: VERSION });
  registerPerplexityTools(s, NAME);
  registerMedicalTools(s);
  registerAcademicTools(s);
  registerConsensusTools(s);
  return makeToolSchemasPortable(s);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3114", 10);

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
