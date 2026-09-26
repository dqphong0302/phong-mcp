/**
 * Cochrane Risk of Bias (RoB 2.0 & ROBINS-I) Structured Assessment Module.
 * Implements standard Cochrane 5-Domain quality criteria and Traffic Light Plots.
 * Docs: https://www.riskofbias.info/welcome/rob-2-0-tool
 */

import { generateTrafficLightPlotSVG, generateSummaryBarSVG } from "./robvis.js";

export const ROB2_DOMAINS = [
  { id: "D1", name: "Randomisation process", desc: "Sequence generation & allocation concealment" },
  { id: "D2", name: "Deviations from intended interventions", desc: "Blinding & assignment vs adherence" },
  { id: "D3", name: "Missing outcome data", desc: "Attrition bias & intention-to-treat completeness" },
  { id: "D4", name: "Measurement of the outcome", desc: "Blinding of outcome assessors & measurement validity" },
  { id: "D5", name: "Selection of the reported result", desc: "Selective outcome reporting against pre-registration" },
];

export const ROBINS_DOMAINS = [
  { id: "D1", name: "Confounding", desc: "Baseline and time-varying confounders" },
  { id: "D2", name: "Selection of participants", desc: "Inception cohort selection bias" },
  { id: "D3", name: "Classification of interventions", desc: "Differential misclassification of intervention status" },
  { id: "D4", name: "Deviations from intended interventions", desc: "Co-interventions and protocol deviations" },
  { id: "D5", name: "Missing data", desc: "Differential loss to follow-up" },
  { id: "D6", name: "Measurement of outcomes", desc: "Subjective vs objective outcome assessment" },
  { id: "D7", name: "Selection of reported result", desc: "Selective reporting of analyses and subgroups" },
];

/**
 * Format risk symbol.
 * @param {"low"|"some_concerns"|"high"|"unclear"} level
 */
function symbolFor(level) {
  const norm = String(level || "").toLowerCase().trim();
  if (norm.includes("low")) return { icon: "🟢", text: "Low Risk", code: "+" };
  if (norm.includes("some") || norm.includes("moderate") || norm.includes("concern")) {
    return { icon: "🟡", text: "Some Concerns", code: "?" };
  }
  if (norm.includes("high") || norm.includes("critical")) return { icon: "🔴", text: "High Risk", code: "-" };
  return { icon: "⚪", text: "Unclear / No Info", code: "U" };
}

/**
 * Calculate Overall Risk of Bias per Cochrane rule:
 * - If all domains Low -> Overall Low
 * - If any domain High -> Overall High
 * - If Some Concerns in 1+ domains and no High -> Overall Some Concerns
 *
 * @param {Array<string>} domainRisks
 * @returns {string}
 */
function calcOverallRisk(domainRisks) {
  if (domainRisks.some((r) => String(r).toLowerCase().includes("high") || String(r).toLowerCase().includes("critical"))) {
    return "high";
  }
  if (domainRisks.some((r) => String(r).toLowerCase().includes("some") || String(r).toLowerCase().includes("concern") || String(r).toLowerCase().includes("moderate"))) {
    return "some_concerns";
  }
  return "low";
}

/**
 * Perform Structured Cochrane Risk of Bias Assessment.
 *
 * @param {Object} input
 * @param {Array<Object>} input.assessments Array of study evaluations:
 *   [
 *     {
 *       study: "Smith et al. 2023",
 *       d1: "low",
 *       d2: "low",
 *       d3: "some_concerns",
 *       d4: "low",
 *       d5: "low",
 *       notes: "Minor loss to follow up in arm B"
 *     }
 *   ]
 * @param {"rob2"|"robins_i"} [input.tool="rob2"] Tool version: rob2 (RCTs) or robins_i (Observational)
 * @param {string} [input.title] Assessment Title
 * @returns {Object} Traffic Light Plot, Table, and Structured Bias Summary
 */
export function assessRiskOfBias(input = {}) {
  const {
    assessments = [],
    tool = "rob2",
    title = "Cochrane Risk of Bias 2.0 (RoB 2.0) Assessment",
  } = input;

  const domainDefs = tool === "robins_i" ? ROBINS_DOMAINS : ROB2_DOMAINS;

  const evaluated = assessments.map((a, idx) => {
    const study = a.study || a.name || `Study ${idx + 1}`;
    const domainScores = {};
    const domainRisksList = [];

    for (const d of domainDefs) {
      const key = d.id.toLowerCase();
      const rawVal = a[key] || a[d.id] || "unclear";
      const sym = symbolFor(rawVal);
      domainScores[d.id] = {
        domain: d.name,
        level: sym.text,
        icon: sym.icon,
        code: sym.code,
      };
      domainRisksList.push(rawVal);
    }

    const overallKey = a.overall || calcOverallRisk(domainRisksList);
    const overallSym = symbolFor(overallKey);

    return {
      study,
      domains: domainScores,
      overall: {
        level: overallSym.text,
        icon: overallSym.icon,
        code: overallSym.code,
      },
      notes: a.notes || a.comment || "",
    };
  });

  // ── Traffic Light Table ───────────────────────────────────────────────────
  let markdown = `## ${title}\n\n`;
  markdown += `*Tool: ${tool === "robins_i" ? "ROBINS-I (Non-Randomized Studies)" : "Cochrane RoB 2.0 (Randomized Controlled Trials)"}*\n\n`;

  // Table header
  markdown += "| Study / Manuscript | ";
  for (const d of domainDefs) {
    markdown += `${d.id} | `;
  }
  markdown += "**Overall** | Notes |\n";

  // Table separator
  markdown += "|:---|";
  for (let i = 0; i < domainDefs.length; i++) markdown += ":---:|";
  markdown += ":---:|:---|\n";

  // Table rows
  for (const ev of evaluated) {
    markdown += `| **${ev.study}** | `;
    for (const d of domainDefs) {
      const sc = ev.domains[d.id];
      markdown += `${sc.icon} | `;
    }
    markdown += `**${ev.overall.icon} ${ev.overall.level}** | ${ev.notes} |\n`;
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  markdown += `\n### 🚦 Risk of Bias Legend & Domain Mapping\n`;
  markdown += `* 🟢 **Low Risk (+)**: Study methods are rigorously valid with minimal potential for bias.\n`;
  markdown += `* 🟡 **Some Concerns (?)**: Potential risk of bias, methodology underspecified or slight deviation.\n`;
  markdown += `* 🔴 **High Risk (-)**: Serious bias that substantially weakens confidence in the study findings.\n\n`;

  markdown += `**Domain Definitions:**\n`;
  for (const d of domainDefs) {
    markdown += `* **${d.id}**: ${d.name} *(${d.desc})*\n`;
  }

  // Count summaries
  const lowCount = evaluated.filter((e) => e.overall.level.includes("Low")).length;
  const someCount = evaluated.filter((e) => e.overall.level.includes("Some")).length;
  const highCount = evaluated.filter((e) => e.overall.level.includes("High")).length;

  const trafficLightSVG = generateTrafficLightPlotSVG({ assessments, tool, title });
  const summaryBarSVG = generateSummaryBarSVG({ assessments, tool, title });

  return {
    title,
    tool,
    summary: {
      totalStudies: evaluated.length,
      lowRiskCount: lowCount,
      someConcernsCount: someCount,
      highRiskCount: highCount,
      highRiskRatio: evaluated.length > 0 ? (highCount / evaluated.length).toFixed(2) : "0.00",
    },
    evaluations: evaluated,
    trafficLightSVG,
    summaryBarSVG,
    markdown,
  };
}
