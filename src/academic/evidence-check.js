/**
 * Evidence Check — Consensus-inspired tool.
 *
 * Given a research question, searches multiple academic sources,
 * analyses abstracts/TLDRs for supporting/contrasting signals,
 * and returns a structured Yes/No/Mixed verdict with evidence.
 *
 * Approach: conclusion-level claim analysis with effect-estimate parsing
 * (see ./stance.js) — deterministic, no external LLM call required.
 *
 * Inspired by: Consensus.app "Consensus Meter" feature.
 */

import { runParallelSearch } from "./orchestrator.js";
import { filterByRelevance } from "./sources/_relevance.js";
import { classifyStance } from "./stance.js";
import { classifyStances } from "./stance-llm.js";
import { reportsResults } from "./publication-type.js";

/**
 * What a paper concludes about the question.
 *
 * Delegates to the stance engine, which reads the conclusion rather than
 * counting cue words across the whole abstract. The previous implementation
 * tallied words like "significant", "reduce" and "associated" anywhere in the
 * text, so a Background sentence praising someone else's drug counted as
 * support, and "no significant difference" scored positively because it
 * contains "significant".
 *
 * @param {import("./formatter.js").AcademicPaper} paper
 * @param {string} question
 * @returns {"yes"|"no"|"mixed"|"unclear"}
 */
export function classifyPaperStance(paper, question) {
  return classifyStance(paper, question).stance;
}

/**
 * Render one paper as an auditable evidence line.
 *
 * Shows the sentence the verdict was actually read from, not the first 200
 * characters of the abstract — which is usually Background text and therefore
 * the one part that had no bearing on the classification.
 *
 * @param {Object} p
 * @param {boolean} [compact]
 * @returns {string[]}
 */
function renderEvidence(p, compact = false) {
  const cite = p.doi ? `https://doi.org/${p.doi}` : p.arxiv_id ? `https://arxiv.org/abs/${p.arxiv_id}` : p.url || "";
  const citStr = p.citation_count != null ? ` · ${p.citation_count} citations` : "";
  const design = p.study_design?.type ? ` · ${p.study_design.type.replace(/_/g, " ")}` : "";
  const quote = p.stance_evidence || p.tldr || (p.abstract ? `${p.abstract.slice(0, 180)}…` : "(no abstract)");

  if (compact) return [`- **${p.title}** (${p.year || "?"}${design}): ${String(quote).slice(0, 170)}`];

  const judge = p.stance_source === "llm" ? " · model-judged" : "";
  const out = [`- **${p.title}** (${p.year || "?"}${citStr}${design}${judge})`];
  out.push(`  > ${String(quote).slice(0, 320)}`);
  if (p.stance_basis) out.push(`  _why:_ ${p.stance_basis}`);
  if (cite) out.push(`  [Source](${cite})`);
  return out;
}

// ── Format verdict ────────────────────────────────────────────────────────────

/**
 * Format the evidence check result as a structured markdown string.
 *
 * @param {string} question
 * @param {Object} grouped   - { yes, no, mixed, unclear } arrays of papers
 * @param {string[]} sources - source IDs used
 * @param {Object} [retrieval] - { retrieved, excluded } screening counts
 * @returns {string}
 */
export function formatEvidenceResult(question, grouped, sources, retrieval = {}) {
  const total = grouped.yes.length + grouped.no.length +
                grouped.mixed.length + grouped.unclear.length;
  if (total === 0) {
    return retrieval.retrieved
      ? `No paper addressing "${question}" was found. ` +
        `${retrieval.retrieved} record(s) were retrieved but none covered the question closely enough to vote on it — ` +
        `broaden the query or widen \`sources\`.`
      : `No papers found for: "${question}"`;
  }

  const countable = grouped.yes.length + grouped.no.length + grouped.mixed.length;

  // Compute verdict
  let verdict;
  let verdictIcon;
  if (countable === 0) {
    verdict = "Unclear";
    verdictIcon = "❓";
  } else if (grouped.yes.length > grouped.no.length * 2 && grouped.yes.length > grouped.mixed.length) {
    verdict = "Yes";
    verdictIcon = "✅";
  } else if (grouped.no.length > grouped.yes.length * 2 && grouped.no.length > grouped.mixed.length) {
    verdict = "No";
    verdictIcon = "❌";
  } else if (grouped.mixed.length >= grouped.yes.length && grouped.mixed.length >= grouped.no.length) {
    verdict = "Mixed";
    verdictIcon = "⚠️";
  } else if (grouped.yes.length >= grouped.no.length) {
    verdict = "Likely Yes";
    verdictIcon = "🟢";
  } else {
    verdict = "Likely No";
    verdictIcon = "🔴";
  }

  const lines = [
    `## Evidence Check: "${question}"`,
    "",
    `**Verdict**: ${verdictIcon} **${verdict}**`,
    `> Based on ${total} papers: ` +
    `✅ Yes: ${grouped.yes.length} | ` +
    `❌ No: ${grouped.no.length} | ` +
    `⚠️ Mixed: ${grouped.mixed.length} | ` +
    `❓ Unclear: ${grouped.unclear.length}`,
    "",
  ];

  // Consensus meter bar
  if (countable > 0) {
    const barLen = 20;
    const yBar = Math.round((grouped.yes.length / countable) * barLen);
    const nBar = Math.round((grouped.no.length / countable) * barLen);
    const mBar = barLen - yBar - nBar;
    const bar = "🟩".repeat(yBar) + "🟥".repeat(nBar) + "🟨".repeat(Math.max(0, mBar));
    lines.push(`**Evidence Distribution**: ${bar}`);
    lines.push("");
  }

  // Supporting evidence
  if (grouped.yes.length > 0) {
    lines.push(`### ✅ Supporting Evidence (${grouped.yes.length})`);
    for (const p of grouped.yes.slice(0, 5)) {
      lines.push(...renderEvidence(p));
    }
    lines.push("");
  }

  // Contrasting evidence
  if (grouped.no.length > 0) {
    lines.push(`### ❌ Contrasting Evidence (${grouped.no.length})`);
    for (const p of grouped.no.slice(0, 5)) {
      lines.push(...renderEvidence(p));
    }
    lines.push("");
  }

  // Mixed evidence
  if (grouped.mixed.length > 0) {
    lines.push(`### ⚠️ Mixed / Inconclusive Evidence (${grouped.mixed.length})`);
    for (const p of grouped.mixed.slice(0, 3)) {
      lines.push(...renderEvidence(p, true));
    }
    lines.push("");
  }

  // Methodology note
  lines.push("---");
  lines.push("### 📋 Methodology Note");
  lines.push(`- Sources searched: ${sources.join(", ")}`);
  lines.push(`- Total papers analysed: ${total}`);
  if (retrieval.offTopic > 0) {
    lines.push(
      `- Screened out as off-topic: ${retrieval.offTopic} of ${retrieval.retrieved} retrieved. ` +
      "A paper may only vote if it mentions the subject of the question."
    );
  }
  const nr = Object.entries(retrieval.notResults || {});
  if (nr.length) {
    const total = nr.reduce((n, [, c]) => n + c, 0);
    lines.push(
      `- Excluded as reporting no findings: ${total} (${nr.map(([k, c]) => `${c} ${k}`).join(", ")}). ` +
      "Protocols, registry entries, editorials and corrections describe or comment on research rather than report it."
    );
  }
  if (retrieval.escalationsApplied > 0) {
    lines.push(
      `- Ambiguous papers referred to a model for a second opinion: ${retrieval.escalationsApplied} ` +
      `of ${retrieval.escalated} referred. The rest were settled by the deterministic rules.`
    );
  }
  lines.push(
    "- Each paper is judged on its **conclusion text** (Conclusions section, TL;DR, or abstract tail), " +
    "with effect estimates (HR/OR/RR/MD + 95% CI) and p-values parsed to decide direction and significance. " +
    "Background and Methods text is ignored so prior work is never counted as this paper's finding."
  );
  lines.push("- This is an automated screening tool — always verify claims against original sources.");
  lines.push("- For high-stakes decisions, consult a systematic review or domain expert.");

  return lines.join("\n");
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Run an evidence check for a research question.
 *
 * @param {string}   question  - research question, e.g. "Does X cause Y?"
 * @param {string[]|string} sources - source preset or list
 * @param {Object}   opts      - { limit, year_min, year_max }
 * @param {Object}   config    - academic config
 * @returns {Promise<string>}  - formatted markdown result
 */
export async function runEvidenceCheck(question, sources, opts = {}, config = {}) {
  const { limit = 10, year_min, year_max } = opts;

  // Use biomedical sources by default if question looks clinical
  // Force sources with rich abstracts + TLDR (semantic_scholar has TLDR, openalex has abstracts)
  // crossref/default preset has poor abstract coverage → "Unclear" for all papers
  const defaultSources = /\b(drug|disease|patient|clinical|treatment|therapy|cancer|covid|diabetes|medical|health|clinical trial)\b/i
    .test(question)
    ? ["pubmed", "semantic_scholar", "openalex", "europe_pmc"]
    : ["semantic_scholar", "openalex", "pubmed"];
  const effectiveSources = sources || defaultSources;

  const { papers } = await runParallelSearch(question, effectiveSources, {
    limit,
    year_min,
    year_max,
    sort: "citations",  // high-citation papers more likely to have consensus
    enrich_pdf: false,  // skip PDF enrichment for speed
  }, config);

  // Only papers that actually address the question may vote on it. Without
  // this gate the stance classifier happily reads a verdict out of whatever the
  // search returned: a metformin/mortality question was answered "Yes" on the
  // strength of papers about IL-6 signalling and SGLT2 inhibitors in HFpEF.
  const onTopic = filterByRelevance(papers, question, {
    getTitle: (p) => p.title || "",
    getText: (p) => `${p.title || ""} ${p.abstract || ""} ${p.takeaway || p.tldr || ""}`,
    minCoverage: 0.5,
    // A paper may only vote on a question if it mentions the thing being asked
    // about. Generic coverage is not enough here: an SGLT2-inhibitor cohort
    // otherwise answers a question about metformin.
    requireAnchors: true,
  });
  const offTopic = papers.length - onTopic.length;

  // A protocol, a registry entry, an editorial or an erratum has no findings to
  // contribute. They read like research to a text classifier, so the SELECT
  // trial's "rationale and design" paper was being counted as evidence that
  // semaglutide works — years before the trial reported.
  const withResults = [];
  const notResults = new Map(); // kind → count
  for (const p of onTopic) {
    const { reports, kind } = reportsResults(p);
    if (reports) withResults.push(p);
    else notResults.set(kind, (notResults.get(kind) || 0) + 1);
  }

  // Classify each paper. Rules settle most of them; only the ones they cannot
  // settle are escalated to a model, and only when that is switched on.
  const { verdicts, escalated, escalationsApplied } =
    await classifyStances(withResults, question, config);

  const grouped = { yes: [], no: [], mixed: [], unclear: [] };
  withResults.forEach((p, i) => {
    const verdict = verdicts[i];
    // Keep the reasoning on the record: every claim in the report can then be
    // traced to the sentence and the estimate it came from.
    p.stance_basis = verdict.basis;
    p.stance_evidence = verdict.evidence;
    p.stance_confidence = verdict.confidence;
    p.stance_source = verdict.source;
    grouped[verdict.stance].push(p);
  });

  // Resolve actual source IDs used
  const usedSources = [...new Set(withResults.map((p) => p.source))];

  return formatEvidenceResult(question, grouped, usedSources, {
    offTopic,
    notResults: Object.fromEntries(notResults),
    retrieved: papers.length,
    escalated,
    escalationsApplied,
  });
}
