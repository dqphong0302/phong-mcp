/**
 * Research Loop MCP tools (Literature -> Writer -> Reviewer, citation audit).
 * Tool names, input schemas and RESEARCH_* env vars match the retired phong-mcp-rust gateway.
 */
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { loadConfig, callTool } from "./core.ts";

const contract = z.string().min(1).max(100000);
const evidence = z.string().min(1).max(350000);
const ledger = z.string().max(150000).optional();
const reviewMode = z.enum(["rapid", "scoping", "systematic", "empirical", "hybrid"]).optional().default("scoping");
const round = z.number().int().min(1).max(10).optional().default(1);

const common = { research_contract: contract, evidence_bundle: evidence, claim_ledger: ledger, review_mode: reviewMode };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

const TOOLS = [
  {
    name: "research_literature_review",
    title: "Literature Review Audit",
    description: "Audit a frozen literature evidence bundle with the configured Literature Reviewer model. The model may identify gaps but may not invent or retrieve citations.",
    shape: { ...common, previous_draft: z.string().max(250000).optional(), round },
  },
  {
    name: "research_write",
    title: "Academic Manuscript Writer",
    description: "Draft or revise an evidence-traceable research manuscript with the configured Writer model.",
    shape: {
      ...common,
      literature_assessment: z.string().min(2).max(100000),
      previous_draft: z.string().max(250000).optional(),
      reviewer_findings: z.string().max(100000).optional(),
      round,
    },
  },
  {
    name: "research_review",
    title: "Independent Peer Review",
    description: "Independently review a frozen research draft with the configured Reviewer model and return routed findings.",
    shape: {
      ...common,
      literature_assessment: z.string().min(2).max(100000),
      draft: z.string().min(1).max(250000),
      round,
    },
  },
  {
    name: "research_verify_citations",
    title: "Citation Entailment Audit",
    description: "Verify citation entailment in a manuscript draft against the evidence bundle. Returns per-sentence ENTAILED/UNGROUNDED/CONTRADICTED/DRIFTED verdicts and an aggregate entailment rate.",
    shape: { draft: z.string().min(1).max(250000), evidence_bundle: evidence, claim_ledger: ledger },
  },
  {
    name: "research_loop_run",
    title: "Full Research Loop",
    description: "Run Literature Reviewer -> Writer -> Independent Reviewer for up to five bounded rounds. Stops early on evidence/method/integrity blockers or a passing decision. Optionally runs post-loop citation entailment audit.",
    shape: {
      ...common,
      initial_draft: z.string().max(250000).optional(),
      max_rounds: z.number().int().min(1).max(5).optional().default(3),
      rerun_literature_each_round: z.boolean().optional().default(false),
      verify_citations: z.boolean().optional().default(true),
    },
  },
];

function wrap(config: Raw, name: Raw) {
  return async (args: Raw) => {
    try {
      const result = await callTool(config, name, args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

export function registerResearchLoopTools(server: Raw) {
  const config = loadConfig();

  server.tool(
    "research_loop_status",
    "Show Research Loop model configuration and readiness without exposing API keys.",
    {},
    { title: "Research Loop Status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    wrap(config, "research_loop_status"),
  );

  for (const t of TOOLS) {
    server.tool(t.name, t.description, t.shape, { title: t.title, idempotentHint: false, ...READ_ONLY }, wrap(config, t.name));
  }
}
