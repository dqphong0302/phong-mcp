#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerImageTools } from "./image/index.js";
import { registerConsensusTools } from "./consensus/index.js";
import { registerPerplexityTools } from "./perplexity/index.js";
import { registerTtsTools } from "./tts/index.js";
import { registerDistillTool } from "./distill/index.js";
import { registerOpsTool } from "./ops/index.js";

async function main() {
  const server = new McpServer({
    name: "phong-mcp",
    version: "1.0.0",
  });

  // Register all tools
  registerImageTools(server);
  registerConsensusTools(server);
  registerPerplexityTools(server, "phong-mcp");
  registerTtsTools(server);
  registerDistillTool(server);
  registerOpsTool(server);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("phong-mcp is running on stdio");
}

main().catch((error) => {
  console.error("Fatal error running phong-mcp:", error);
  process.exit(1);
});
