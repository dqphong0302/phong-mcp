/**
 * Test các academic tools (không dùng Semantic Scholar).
 * Run: node test/academic-test.ts
 */

import type { Dict, Raw } from "../src/academic/types.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAcademicTools } from "../src/academic/index.ts";
import { registerConsensusTools } from "../src/consensus/index.ts";

const server = new McpServer({
  name: "phong-academic-test",
  version: "1.0.0",
});
registerAcademicTools(server);
registerConsensusTools(server);

async function callTool(name: Raw, args: Raw) {
  const tool = (server as unknown as { _registeredTools: Record<string, Dict> })._registeredTools[name];
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const start = Date.now();
  // McpServer stores handler in tool.handler (not callback)
  const result = await tool.handler(args);
  const ms = Date.now() - start;
  return { result, ms };
}

function print(label: Raw, { result, ms }: Raw) {
  const isErr = result.isError;
  const text = result.content?.[0]?.text || "";
  const preview = text.slice(0, 600);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[${isErr ? "❌ FAIL" : "✅ PASS"}] ${label} (${ms}ms)`);
  console.log("-".repeat(70));
  console.log(preview);
  if (text.length > 600) console.log(`... (${text.length} chars total)`);
}

async function run() {
  console.log("📚 Academic Tools Test Suite (no Semantic Scholar key)\n");

  // ── TEST 1: academic_search via OpenAlex only ──────────────────────────────
  print("academic_search [openalex] — 'transformer attention mechanism'",
    await callTool("academic_search", {
      query: "transformer attention mechanism deep learning",
      sources: ["openalex"],
      limit: 3,
      sort: "citations",
    })
  );

  // ── TEST 2: academic_search via arXiv (CS/AI) ─────────────────────────────
  await new Promise(r => setTimeout(r, 3500)); // arXiv 3s throttle
  print("academic_search [arxiv] — 'LLM chain of thought reasoning' (cs.AI, cs.CL)",
    await callTool("academic_search", {
      query: "chain of thought reasoning large language models",
      sources: ["arxiv"],
      arxiv_categories: ["cs.AI", "cs.CL"],
      sort: "recency",
      limit: 3,
    })
  );

  // ── TEST 3: academic_search via PubMed ────────────────────────────────────
  print("academic_search [pubmed] — 'metformin longevity aging'",
    await callTool("academic_search", {
      query: "metformin longevity aging clinical trial",
      sources: ["pubmed"],
      limit: 3,
      sort: "relevance",
    })
  );

  // ── TEST 4: academic_search multi-source OpenAlex + arXiv ─────────────────
  await new Promise(r => setTimeout(r, 3500)); // arXiv throttle
  print("academic_search [openalex + arxiv] — 'RAG retrieval augmented generation'",
    await callTool("academic_search", {
      query: "retrieval augmented generation RAG knowledge",
      sources: ["openalex", "arxiv"],
      arxiv_categories: ["cs.AI", "cs.IR", "cs.CL"],
      year_min: 2022,
      sort: "citations",
      limit: 4,
    })
  );

  // ── TEST 5: academic_get_paper by arXiv ID (newer paper, in OA) ─────────────
  await new Promise(r => setTimeout(r, 3500)); // arXiv throttle
  print("academic_get_paper [arXiv] — RAG survey (2312.10997)",
    await callTool("academic_get_paper", { id: "2312.10997" })
  );

  // ── TEST 6: academic_get_paper by DOI (known OpenAlex paper) ─────────────────
  print("academic_get_paper [DOI] — BERT paper",
    await callTool("academic_get_paper", { id: "10.18653/v1/N19-1423" })
  );



  // ── TEST 10: academic_cite (Semantic Scholar) ─────────────────────────────
  await new Promise(r => setTimeout(r, 2000)); // S2 rate limit recovery
  print("academic_cite [S2] — RAG survey citations (top 5)",
    await callTool("academic_cite", {
      paper_id: "2312.10997",
      direction: "citations",
      limit: 5,
    })
  );

  // ── TEST 11: academic_search via Crossref ────────────────────────────────
  print("academic_search [crossref] — 'quantum computing state of the art'",
    await callTool("academic_search", {
      query: "quantum computing state of the art",
      sources: ["crossref"],
      limit: 3,
    })
  );

  // ── TEST 12: academic_search via Europe PMC ──────────────────────────────
  print("academic_search [europe_pmc] — 'CRISPR Cas9 genome editing'",
    await callTool("academic_search", {
      query: "CRISPR Cas9 genome editing",
      sources: ["europe_pmc"],
      limit: 3,
    })
  );

  // ── TEST 13: academic_search via DBLP ────────────────────────────────────
  print("academic_search [dblp] — 'deep learning architecture'",
    await callTool("academic_search", {
      query: "deep learning architecture",
      sources: ["dblp"],
      limit: 3,
    })
  );

  // ── TEST 14: academic_search multi-source (All available free sources) ───
  await new Promise(r => setTimeout(r, 3500)); // arXiv throttle
  print("academic_search [all sources] — 'retrieval augmented generation benchmark'",
    await callTool("academic_search", {
      query: "retrieval augmented generation benchmark",
      sources: ["openalex", "crossref", "europe_pmc", "dblp", "arxiv"],
      arxiv_categories: ["cs.AI", "cs.CL"],
      sort: "relevance",
      limit: 2,
    })
  );

  // ── TEST 15: academic_format_cite — manual fields (no fetch) ─────────────
  print("academic_format_cite [manual] — APA/IEEE/BibTeX for a Vietnamese paper",
    await callTool("academic_format_cite", {
      title: "MedGemma: Retrieval-Augmented Generation for Vietnamese Medical QA",
      authors: ["Nguyen Van A", "Tran Thi B", "Le Van C"],
      year: 2025,
      venue: "Proceedings of EMNLP 2025",
      volume: "3",
      issue: "1",
      pages: "123-135",
      doi: "10.1234/medgemma.2025",
      type: "conference",
      styles: ["apa", "ieee", "bibtex", "vancouver", "mla"],
    })
  );

  // ── TEST 16: academic_format_cite — auto-fetch BERT DOI ───────────────────
  print("academic_format_cite [DOI auto-fetch] — BERT paper",
    await callTool("academic_format_cite", {
      paper_id: "10.18653/v1/N19-1423",
      styles: ["apa", "ieee", "bibtex"],
    })
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log("✅ All tests completed.");
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
