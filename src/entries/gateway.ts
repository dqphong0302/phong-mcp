#!/usr/bin/env node
/**
 * phong-mcp gateway — curated tool set served behind nginx /phong-mcp/ (port 8775).
 * Replaces the retired Rust gateway (phong-mcp-rust). Deliberately excludes the
 * SSH ops tool (`server`), `auth_fetch_url`, `code_review`, `distill` and image tools.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { makeToolSchemasPortable } from "../academic/mcp-compat.ts";
import { registerPerplexityTools } from "../perplexity/index.ts";
import { registerMedicalTools } from "../medical/index.ts";
import { registerMedicalSearchAlias } from "../medical/alias.ts";
import { registerAcademicTools } from "../academic/index.ts";
import { registerConsensusTools } from "../consensus/index.ts";
import { registerSearchTools } from "../search/index.ts";
import { registerScrapeTools } from "../scrape/index.ts";
import { registerTtsTools } from "../tts/index.ts";
import { registerResearchLoopTools } from "../research-loop/index.ts";

const NAME = "phong-mcp";
const VERSION = "2.0.0";

export function createGatewayServer() {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerPerplexityTools(server, NAME);
  registerMedicalTools(server);
  registerMedicalSearchAlias(server);
  registerAcademicTools(server);
  registerConsensusTools(server);
  registerSearchTools(server);
  registerScrapeTools(server);
  registerTtsTools(server);
  registerResearchLoopTools(server);
  return makeToolSchemasPortable(server);
}

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "http";
  const PORT = parseInt(process.env.PORT || "8775", 10);
  if (TRANSPORT === "http") {
    const { startHttpTransport } = await import("../transport-http.ts");
    await startHttpTransport(PORT, createGatewayServer);
  } else {
    await createGatewayServer().connect(new StdioServerTransport());
    console.error(`${NAME} gateway v${VERSION} on stdio`);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
