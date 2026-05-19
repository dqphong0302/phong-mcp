#!/usr/bin/env node

/**
 * phong-mcp (public Docker image)
 * Supports both stdio and HTTP/SSE transport.
 * 
 * ENV:
 *   TRANSPORT=stdio|http (default: stdio)
 *   PORT=3100 (for HTTP mode)
 *   NROUTER_API_KEY=<key>
 *   NROUTER_BASE_URL=<url> (optional, defaults to https://9router.phongdang.io.vn)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerImageTools } from "./image/index.js";
import { registerConsensusTools } from "./consensus/index.js";
import { registerPerplexityTools } from "./perplexity/index.js";
import { registerDistillTool } from "./distill/index.js";

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3100", 10);

async function main() {
  const server = new McpServer({
    name: "phong-mcp",
    version: "1.0.0",
    description: "AI-powered MCP tools: web search, academic papers, image generation, and content analysis.",
  });

  // Register public tools only
  registerImageTools(server);
  registerConsensusTools(server);
  registerPerplexityTools(server, "phong-mcp");
  registerDistillTool(server);

  if (TRANSPORT === "http") {
    // Dynamic import to avoid loading http deps in stdio mode
    const { startHttpTransport } = await import("./transport-http.js");
    await startHttpTransport(server, PORT);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("phong-mcp (public) running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error running phong-mcp:", error);
  process.exit(1);
});
