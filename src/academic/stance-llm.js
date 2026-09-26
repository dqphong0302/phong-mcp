/**
 * LLM escalation for the stance engine.
 *
 * The rule engine in ./stance.js settles the clear cases for free, offline and
 * deterministically. It cannot settle everything: unusual phrasing, abstracts
 * with no structure, and non-English conclusions still come back "unclear" or
 * with low confidence.
 *
 * This module sends ONLY those papers to a model. That keeps the common path
 * deterministic and instant, and pays for a network round trip on the handful
 * of papers per query that actually need judgement.
 *
 * Failure is never fatal: a timeout, a bad payload or an unreachable router
 * leaves the rule engine's verdict in place.
 */

import { classifyStance } from "./stance.js";

/** Rule verdicts at or below this confidence are worth a second opinion. */
const ESCALATE_BELOW = 0.65;

/** Cap on papers sent per call so one odd query cannot fan out unboundedly. */
const MAX_ESCALATIONS = 8;

/** Parallel requests. The router handles this comfortably; the wall clock is one round trip. */
const CONCURRENCY = 4;

const SYSTEM_PROMPT = [
  "You decide what a single paper concludes about a research question.",
  "",
  "Rules:",
  "- Judge ONLY the paper's own finding. Ignore Background/Introduction sentences that describe other people's work.",
  "- A confidence interval that spans the null value (1 for ratios, 0 for differences) is a null result, even if the text says 'reduced'.",
  "- p > 0.05 is a null result.",
  "- An effect in the opposite direction to the question is 'no'.",
  "- Hedged claims ('may', 'further studies needed') with no significant estimate are 'mixed'.",
  "- If the paper does not address the question, or reports no findings (a protocol, editorial or registry entry), answer 'unclear'.",
  "",
  'Reply with JSON only: {"stance":"yes|no|mixed|unclear","basis":"<short reason>","evidence":"<the sentence you used, verbatim>"}',
].join("\n");

const VALID = new Set(["yes", "no", "mixed", "unclear"]);

/**
 * Should this rule verdict get a second opinion?
 *
 * @param {{stance:string, confidence:number}} verdict
 * @returns {boolean}
 */
export function needsEscalation(verdict) {
  return verdict.stance === "unclear" || verdict.confidence < ESCALATE_BELOW;
}

/** Trim a paper to the text the model needs, keeping the token bill small. */
function paperPayload(paper) {
  const abstract = String(paper?.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [
    `Title: ${paper?.title || "(untitled)"}`,
    abstract ? `Abstract: ${abstract.slice(0, 4000)}` : "Abstract: (none)",
  ].join("\n");
}

/** Pull the JSON object out of a reply that may be fenced or prose-wrapped. */
function parseReply(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1));
    const stance = String(obj.stance || "").toLowerCase().trim();
    if (!VALID.has(stance)) return null;
    return {
      stance,
      basis: typeof obj.basis === "string" ? obj.basis.slice(0, 300) : "",
      evidence: typeof obj.evidence === "string" ? obj.evidence.slice(0, 600) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Ask the model about one paper. Resolves to null on any failure.
 *
 * @param {Object} paper
 * @param {string} question
 * @param {Object} cfg  { baseUrl, apiKey, model, timeoutMs }
 * @returns {Promise<{stance:string, basis:string, evidence:string|null}|null>}
 */
async function askModel(paper, question, cfg) {
  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Question: ${question}\n\n${paperPayload(paper)}` },
        ],
        // Deterministic as far as the provider allows, so repeating a search
        // does not quietly change a verdict.
        temperature: 0,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return parseReply(data?.choices?.[0]?.message?.content);
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with a fixed number of workers in flight. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Classify every paper, escalating only the ones the rules could not settle.
 *
 * @param {Object[]} papers
 * @param {string} question
 * @param {Object} [config] academic config; `stanceLlm` holds the model settings
 * @returns {Promise<{verdicts: Array, escalated: number, escalationsApplied: number}>}
 */
export async function classifyStances(papers, question, config = {}) {
  const verdicts = papers.map((p) => ({ ...classifyStance(p, question), source: "rules" }));

  const llm = config.stanceLlm || {};
  if (!llm.enabled || !llm.model || !llm.baseUrl) {
    return { verdicts, escalated: 0, escalationsApplied: 0 };
  }

  // Lowest-confidence first, so the cap spends its budget where it matters most.
  const candidates = verdicts
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => needsEscalation(v))
    .sort((a, b) => a.v.confidence - b.v.confidence)
    .slice(0, llm.maxEscalations ?? MAX_ESCALATIONS);

  if (candidates.length === 0) {
    return { verdicts, escalated: 0, escalationsApplied: 0 };
  }

  const answers = await mapLimit(
    candidates,
    llm.concurrency ?? CONCURRENCY,
    ({ i }) => askModel(papers[i], question, llm)
  );

  let applied = 0;
  answers.forEach((answer, k) => {
    if (!answer) return; // router down or unparseable — keep the rule verdict
    const { i } = candidates[k];
    verdicts[i] = {
      stance: answer.stance,
      // Escalated verdicts are read from the same text but by a different
      // judge; do not present them as more certain than a parsed estimate.
      confidence: 0.7,
      basis: answer.basis || "model judgement on the paper's conclusion",
      evidence: answer.evidence || verdicts[i].evidence,
      origin: verdicts[i].origin,
      source: "llm",
    };
    applied++;
  });

  return { verdicts, escalated: candidates.length, escalationsApplied: applied };
}

export default { classifyStances, needsEscalation };
