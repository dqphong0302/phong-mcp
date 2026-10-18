/**
 * Factory: creates a fresh McpServer instance with all tools registered.
 * Exported separately to avoid circular imports between index.ts ↔ transport-http.ts.
 * In HTTP mode, called once per SSE client so each session is fully isolated.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeToolSchemasPortable } from "./academic/mcp-compat.ts";
import { registerImageTools } from "./image/index.ts";
import { registerTtsTools } from "./tts/index.ts";
import { registerDistillTool } from "./distill/index.ts";
import { registerServerTool } from "./server/index.ts";
import { registerCodeReviewTool } from "./code-review/index.ts";
import { registerFileConvertTool } from "./file-convert/index.ts";
import { registerContentGenTool } from "./content-gen/index.ts";
import { registerFetchTool, registerAuthFetchTool } from "./fetch/index.ts";
import { registerDiagramTools } from "./diagram/index.ts";
import { registerPerplexityTools } from "./perplexity/index.ts";
import { registerMedicalTools } from "./medical/index.ts";
import { registerAcademicTools } from "./academic/index.ts";
import { registerConsensusTools } from "./consensus/index.ts";
import { registerSearchTools } from "./search/index.ts";
import { registerScrapeTools } from "./scrape/index.ts";

export function createServer() {
  const server = new McpServer({
    name: "phong-mcp",
    version: "1.4.0",
  });

  registerImageTools(server);
  registerTtsTools(server);
  registerDistillTool(server);
  registerServerTool(server);
  registerCodeReviewTool(server);
  registerFileConvertTool(server);
  registerContentGenTool(server);
  registerFetchTool(server);
  registerAuthFetchTool(server);
  registerDiagramTools(server);
  registerPerplexityTools(server);
  registerMedicalTools(server);
  registerAcademicTools(server);
  registerConsensusTools(server);
  registerSearchTools(server);
  registerScrapeTools(server);

  // Portable schemas so Codex, Gemini/Antigravity and Claude all accept the tools.
  return makeToolSchemasPortable(server);
}
