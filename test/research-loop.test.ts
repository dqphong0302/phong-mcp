import type { Dict, Raw } from "../src/academic/types.ts";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

const lit = { decision: "PASS", coverage_summary: "ok", verified_strengths: [], gaps: [], targeted_queries: [], unsupported_citations: [], limitations: [] };
const rev = { decision: "PASS", summary: "ok", findings: [], claim_ids_checked: ["CLM-1"], limitations: [] };
const audit = {
  total_audited: 1, entailed_count: 1, ungrounded_count: 0, contradicted_count: 0, drifted_count: 0, entailment_rate: 1,
  results: [{ sentence_id: "P1_S1", text: "X [1].", verdict: "ENTAILED", citations: ["[1]"], reasoning: "ok", suggested_fix: null }],
};

function mock(calls: Raw) {
  return http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const sys = JSON.parse(b).messages[0].content;
      calls.push(sys.slice(0, 40));
      let content;
      if (sys.startsWith("You are an evidence-bound literature")) content = "```json\n" + JSON.stringify(lit) + "\n```";
      else if (sys.startsWith("You are an evidence-bound academic")) content = "Draft CLM-1 claim [1].";
      else if (sys.startsWith("You are a scientific reviewer")) content = JSON.stringify(rev);
      else content = JSON.stringify(audit);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 5) } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(5) } }], usage: { total_tokens: 3 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
}

test("research_loop_run passes and runs the citation gate over an SSE gateway", async () => {
  const calls: Raw = [];
  const srv: Raw = mock(calls);
  await new Promise<void>((r) => srv.listen(0, () => r()));
  process.env.RESEARCH_LOOP_API_KEY = "k";
  process.env.RESEARCH_LOOP_BASE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const { loadConfig, callTool } = await import("../src/research-loop/core.ts");
  const cfg = loadConfig();
  const out: Dict = await callTool(cfg, "research_loop_run", { research_contract: "c", evidence_bundle: "e", claim_ledger: "CLM-1" });
  srv.close();
  assert.equal(out.status, "PASS");
  assert.equal(out.rounds_completed, 1);
  assert.equal(out.citation_audit.entailment_rate, 1);
  assert.equal(calls.length, 4);
  await assert.rejects(callTool(cfg, "research_write", { research_contract: "c", evidence_bundle: "e", literature_assessment: "{}", api_key: "x" }), /Secret-like/);
});
