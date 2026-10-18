#!/usr/bin/env node
/**
 * home-server-mcp — All tools in one process (replaces phong-academic,
 * phong-image, phong-content, phong-fetch, phong-research, phong-ops).
 *
 * Tools registered:
 *   fetch: fetch_url, auth_fetch_url
 *   image: image_create_image, image_process_image
 *   diagram: diagram_render, diagram_explain, diagram_paperbanana_generate
 *   academic: academic_search, academic_cite, academic_get_paper,
 *             academic_batch_format, academic_batch_download,
 *             academic_extract, academic_evidence_check, academic_cache_stats
 *   consensus: consensus_search_papers, consensus_deep_search_papers
 *   content: content_generator, distill, file_convert, code_review
 *   research: perplexity_ask, perplexity_research, perplexity_reason,
 *             perplexity_search, medical_search_academic, medical_ask_openevidence
 *   ops: tts_generate_audio, asr_transcribe, server ops
 */
import type { Raw } from "../academic/types.ts";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try {
  const _origLookup = dns.lookup;
  (dns as { lookup: unknown }).lookup = function (hostname: Raw, options: Raw, callback: Raw) {
    if (typeof options === "function") {
      callback = options;
      options = { family: 4 };
    } else if (typeof options === "object" && options !== null) {
      options = { ...options, family: 4 };
    } else if (typeof options === "number") {
      options = 4;
    }
    return (_origLookup as unknown as (...a: unknown[]) => unknown).call(dns, hostname, options, callback);
  };
} catch {}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server-factory.ts";

const NAME = "home-server-mcp";
const VERSION = "1.0.0";

async function main() {
  const server = createServer();
  // Override server name for this consolidated entry
  server.server.name = NAME;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${NAME} v${VERSION} on stdio`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
