#!/usr/bin/env node

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server-factory.ts";

async function main() {
  const TRANSPORT = process.env.TRANSPORT || "stdio";
  const PORT = parseInt(process.env.PORT || "3100", 10);

  if (TRANSPORT === "http") {
    const { startHttpTransport } = await import("./transport-http.ts");
    await startHttpTransport(PORT);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("phong-mcp v1.4.0 is running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error running phong-mcp:", error);
  process.exit(1);
});
