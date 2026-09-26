/**
 * Indirect Treatment Comparison (ITC) & Network Meta-Analysis (NMA) Geometry Engine.
 * 
 * Implements:
 * 1. Bucher (1997) Anchored Indirect Treatment Comparison.
 * 2. Direct vs Indirect Evidence Inconsistency Test (Bucher Inconsistency Z-test).
 * 3. Network Geometry Plot SVG Generator (Evidence Map).
 * 
 * Standards:
 * - Bucher et al. (1997). The results of direct and indirect treatment comparisons in meta-analysis. J Clin Epidemiol.
 * - NICE Decision Support Unit (DSU) Technical Support Document 2 & 18.
 * - PRISMA-NMA (PRISMA for Network Meta-Analyses).
 */

import { pValueFromZ } from "./meta-analysis.js";

/**
 * Standardize contrast input (either direct estimate or 2x2 data)
 */
function standardizeContrast(input = {}, defaultName = "Contrast") {
  const name = input.name || input.study || defaultName;
  const intervention = input.intervention || input.treatmentA || "Treatment A";
  const anchor = input.anchor || input.comparator || input.treatmentB || "Anchor C";

  const has2x2 = typeof input.e1 === "number" && typeof input.n1 === "number" &&
                 typeof input.e2 === "number" && typeof input.n2 === "number";

  let est = typeof input.estimate === "number" ? input.estimate : typeof input.effect === "number" ? input.effect : null;
  let ciLow = typeof input.ciLow === "number" ? input.ciLow : null;
  let ciHigh = typeof input.ciHigh === "number" ? input.ciHigh : null;

  // If 2x2 contingency data is provided, derive the estimate and its CI from it.
  if (has2x2) {
    const e1 = input.e1 + 0.5;
    const n1 = input.n1 + 0.5;
    const e2 = input.e2 + 0.5;
    const n2 = input.n2 + 0.5;

    const r1 = e1 / n1;
    const r2 = e2 / n2;
    est = r1 / r2;
    const se = Math.sqrt(1 / e1 - 1 / n1 + 1 / e2 - 1 / n2);
    ciLow = Math.exp(Math.log(est) - 1.96 * se);
    ciHigh = Math.exp(Math.log(est) + 1.96 * se);
  }

  // A Bucher contrast is entirely a variance calculation: the indirect standard
  // error comes from the two reported confidence intervals and nothing else.
  // Missing inputs used to default to estimate=1 with a CI of ±20%/25%, which
  // manufactures an SE of ~0.114 for every trial whatever its real size, and
  // then prints the result as a genuine indirect comparison. Refuse instead of
  // inventing the precision.
  if (est === null) {
    throw new Error(
      `${name}: an effect estimate is required — provide "estimate" (with ciLow/ciHigh) or 2x2 counts (e1, n1, e2, n2).`
    );
  }
  if (ciLow === null || ciHigh === null) {
    throw new Error(
      `${name}: 95% CI bounds are required — provide ciLow and ciHigh, or 2x2 counts (e1, n1, e2, n2) to derive them. ` +
      `The indirect standard error is computed from the CI and cannot be assumed.`
    );
  }
  if (!(est > 0) || !(ciLow > 0) || !(ciHigh > 0)) {
    throw new Error(`${name}: ratio measures are analysed on the log scale, so estimate, ciLow and ciHigh must all be > 0.`);
  }
  if (!(ciLow < ciHigh)) {
    throw new Error(`${name}: ciLow (${ciLow}) must be below ciHigh (${ciHigh}).`);
  }
  if (est < ciLow || est > ciHigh) {
    throw new Error(`${name}: the estimate (${est}) lies outside its own 95% CI [${ciLow}, ${ciHigh}].`);
  }

  const logEst = Math.log(Math.max(0.0001, est));
  const se = (Math.log(Math.max(0.0001, ciHigh)) - Math.log(Math.max(0.0001, ciLow))) / (2 * 1.96);

  return {
    name,
    intervention,
    anchor,
    estimate: Number(est.toFixed(3)),
    ciLow: Number(ciLow.toFixed(3)),
    ciHigh: Number(ciHigh.toFixed(3)),
    logEstimate: Number(logEst.toFixed(4)),
    se: Number(Math.max(0.0001, se).toFixed(4)),
  };
}

/**
 * Perform Bucher Anchored Indirect Treatment Comparison
 * 
 * @param {Object} trialAC Intervention A vs Common Anchor C
 * @param {Object} trialBC Intervention B vs Common Anchor C
 * @param {Object} [directAB] Optional direct trial evidence of A vs B for inconsistency testing
 * @param {Object} [options]
 * @returns {Object}
 */
export function runBucherITC(trialAC = {}, trialBC = {}, directAB = null, options = {}) {
  const {
    measure = "RR",
    title = "Anchored Indirect Treatment Comparison (Bucher Method)",
  } = options;

  const ac = standardizeContrast(trialAC, "Trial A vs C");
  const bc = standardizeContrast(trialBC, "Trial B vs C");

  const drugA = ac.intervention;
  const drugB = bc.intervention;
  const anchor = ac.anchor;

  // Bucher Indirect Formula:
  // ln(theta_AB) = ln(theta_AC) - ln(theta_BC)
  // SE(ln(theta_AB)) = sqrt(SE_AC^2 + SE_BC^2)
  const logIndirect = ac.logEstimate - bc.logEstimate;
  const seIndirect = Math.sqrt(ac.se * ac.se + bc.se * bc.se);

  const indirectEst = Math.exp(logIndirect);
  const indirectLow = Math.exp(logIndirect - 1.96 * seIndirect);
  const indirectHigh = Math.exp(logIndirect + 1.96 * seIndirect);

  const zScore = seIndirect > 0 ? logIndirect / seIndirect : 0;
  const pVal = pValueFromZ(zScore);

  let finding = "";
  if (pVal < 0.05) {
    if (indirectEst < 1.0) {
      finding = `Favours ${drugA} over ${drugB} (Statistically Significant, p = ${pVal.toFixed(4)})`;
    } else {
      finding = `Favours ${drugB} over ${drugA} (Statistically Significant, p = ${pVal.toFixed(4)})`;
    }
  } else {
    finding = `Inconclusive / No statistically significant difference between ${drugA} and ${drugB} (p = ${pVal.toFixed(4)})`;
  }

  // Optional Inconsistency Testing if Direct Evidence A vs B is provided
  let inconsistencyTest = null;
  if (directAB && (typeof directAB.estimate === "number" || typeof directAB.effect === "number")) {
    const dir = standardizeContrast(directAB, "Direct Head-to-Head Trial");
    const diff = dir.logEstimate - logIndirect;
    const seDiff = Math.sqrt(dir.se * dir.se + seIndirect * seIndirect);
    const zDiff = seDiff > 0 ? diff / seDiff : 0;
    const pDiff = pValueFromZ(zDiff);

    inconsistencyTest = {
      directEstimate: dir.estimate,
      directCI: [dir.ciLow, dir.ciHigh],
      indirectEstimate: Number(indirectEst.toFixed(3)),
      indirectCI: [Number(indirectLow.toFixed(3)), Number(indirectHigh.toFixed(3))],
      difference: Number(diff.toFixed(4)),
      seDifference: Number(seDiff.toFixed(4)),
      zScore: Number(zDiff.toFixed(3)),
      pValue: Number(pDiff.toFixed(5)),
      hasInconsistency: pDiff < 0.05,
      verdict: pDiff < 0.05
        ? "⚠ Significant Inconsistency detected between direct and indirect evidence (p < 0.05). Check for effect modifier imbalances across trial networks."
        : "✓ Consistency Assumption holds (p ≥ 0.05). Direct and indirect estimates are concordant.",
    };
  }

  // Markdown Report
  let markdown = `## ${title}\n\n`;
  markdown += `*Method: Bucher (1997) Anchored Indirect Comparison via Common Anchor **${anchor}***\n\n`;

  markdown += `### 📋 Direct Input Contrasts (via ${anchor})\n`;
  markdown += `| Contrast | Intervention | Anchor | ${measure} (95% CI) | SE (log) |\n`;
  markdown += `|:---|:---|:---|:---:|:---:|\n`;
  markdown += `| **${ac.name}** | ${drugA} | ${anchor} | ${ac.estimate} [${ac.ciLow}, ${ac.ciHigh}] | ${ac.se} |\n`;
  markdown += `| **${bc.name}** | ${drugB} | ${anchor} | ${bc.estimate} [${bc.ciLow}, ${bc.ciHigh}] | ${bc.se} |\n\n`;

  markdown += `### 🎯 Anchored Indirect Result: **${drugA}** vs **${drugB}**\n`;
  markdown += `- **Indirect ${measure} (95% CI)**: **${indirectEst.toFixed(3)} [${indirectLow.toFixed(3)}, ${indirectHigh.toFixed(3)}]**\n`;
  markdown += `- **Hypothesis Test**: $Z = ${zScore.toFixed(3)}$, $p = ${pVal < 0.001 ? "< 0.001" : pVal.toFixed(4)}$\n`;
  markdown += `- **Clinical Interpretation**: **${finding}**\n\n`;

  if (inconsistencyTest) {
    markdown += `### ⚖️ Direct vs. Indirect Inconsistency Test (Node-Splitting)\n`;
    markdown += `- **Direct Estimate**: ${inconsistencyTest.directEstimate} [${inconsistencyTest.directCI.join(", ")}]\n`;
    markdown += `- **Indirect Estimate**: ${inconsistencyTest.indirectEstimate} [${inconsistencyTest.indirectCI.join(", ")}]\n`;
    markdown += `- **Inconsistency $p$-value**: **${inconsistencyTest.pValue}** (${inconsistencyTest.verdict})\n\n`;
  }

  return {
    title,
    measure,
    anchor,
    drugA,
    drugB,
    inputContrasts: { ac, bc },
    indirect: {
      estimate: Number(indirectEst.toFixed(3)),
      ciLow: Number(indirectLow.toFixed(3)),
      ciHigh: Number(indirectHigh.toFixed(3)),
      logEstimate: Number(logIndirect.toFixed(4)),
      se: Number(seIndirect.toFixed(4)),
      zScore: Number(zScore.toFixed(3)),
      pValue: Number(pVal.toFixed(5)),
      finding,
    },
    inconsistencyTest,
    markdown,
  };
}

/**
 * Generate Network Meta-Analysis Geometry Plot SVG
 * 
 * @param {Object} options
 * @param {Array<Object>} options.nodes Array of intervention nodes: [{ id, label, totalN }]
 * @param {Array<Object>} options.edges Array of direct comparisons: [{ source, target, studiesCount, totalN }]
 * @param {string} [options.title]
 * @returns {string} Vector SVG
 */
export function generateNetworkGeometrySVG(options = {}) {
  const {
    nodes = [
      { id: "A", label: "Drug A", totalN: 1250 },
      { id: "B", label: "Drug B", totalN: 980 },
      { id: "C", label: "Placebo / SoC", totalN: 2200 },
    ],
    edges = [
      { source: "A", target: "C", studiesCount: 4, totalN: 3450 },
      { source: "B", target: "C", studiesCount: 3, totalN: 3180 },
    ],
    title = "Network Meta-Analysis Evidence Geometry",
  } = options;

  const width = 680;
  const height = 480;
  const cx = width / 2;
  const cy = height / 2 + 20;
  const radius = 160;

  const numNodes = nodes.length;
  if (numNodes === 0) return `<svg viewBox="0 0 400 100"><text x="20" y="50">No nodes provided</text></svg>`;

  // Calculate node positions around circle
  const nodeCoords = {};
  const maxN = Math.max(...nodes.map((n) => n.totalN || 1000), 1000);

  nodes.forEach((node, idx) => {
    const angle = (idx / numNodes) * 2 * Math.PI - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const nVal = node.totalN || 1000;
    const nodeR = Math.max(20, Math.min(42, 20 + (nVal / maxN) * 20));
    nodeCoords[node.id] = { x, y, r: nodeR, label: node.label || node.id, n: nVal };
  });

  const maxStudies = Math.max(...edges.map((e) => e.studiesCount || 1), 1);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">\n`;
  svg += `  <style>\n`;
  svg += `    .nma-title { font-size: 16px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `    .nma-sub { font-size: 12px; fill: #64748b; }\n`;
  svg += `    .nma-node-lbl { font-size: 13px; font-weight: 700; fill: #0f172a; text-anchor: middle; dominant-baseline: middle; }\n`;
  svg += `    .nma-node-sub { font-size: 10px; font-weight: 500; fill: #475569; text-anchor: middle; dominant-baseline: middle; }\n`;
  svg += `    .nma-edge-lbl { font-size: 11px; font-weight: 700; fill: #1d4ed8; text-anchor: middle; dominant-baseline: middle; }\n`;
  svg += `  </style>\n`;

  // Background
  svg += `  <rect width="${width}" height="${height}" fill="#ffffff" rx="8"/>\n`;
  svg += `  <text x="24" y="30" class="nma-title">${title}</text>\n`;
  svg += `  <text x="24" y="48" class="nma-sub">Network Map • Node size ∝ Patients Enrolled • Edge thickness ∝ Direct Trials</text>\n`;

  // Edges
  edges.forEach((edge) => {
    const c1 = nodeCoords[edge.source];
    const c2 = nodeCoords[edge.target];
    if (!c1 || !c2) return;

    const count = edge.studiesCount || 1;
    const strokeW = Math.max(2, Math.min(12, 2 + (count / maxStudies) * 8));

    svg += `  <g>\n`;
    svg += `    <line x1="${c1.x}" y1="${c1.y}" x2="${c2.x}" y2="${c2.y}" stroke="#3b82f6" stroke-width="${strokeW}" stroke-linecap="round">\n`;
    svg += `      <title>Direct trials: ${count} studies (${edge.totalN ? edge.totalN + ' pts' : ''})</title>\n`;
    svg += `    </line>\n`;

    // Edge label badge in the middle
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    svg += `    <circle cx="${mx}" cy="${my}" r="11" fill="#eff6ff" stroke="#3b82f6" stroke-width="1.5"/>\n`;
    svg += `    <text x="${mx}" y="${my}" class="nma-edge-lbl">${count}</text>\n`;
    svg += `  </g>\n`;
  });

  // Nodes
  nodes.forEach((node) => {
    const c = nodeCoords[node.id];
    if (!c) return;

    const isAnchor = c.label.toLowerCase().includes("placebo") || c.label.toLowerCase().includes("soc");
    const fillColor = isAnchor ? "#f1f5f9" : "#ecfdf5";
    const strokeColor = isAnchor ? "#64748b" : "#059669";

    svg += `  <g>\n`;
    svg += `    <circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2.5">\n`;
    svg += `      <title>${c.label}: ${c.n} patients enrolled</title>\n`;
    svg += `    </circle>\n`;
    svg += `    <text x="${c.x}" y="${c.y - 6}" class="nma-node-lbl">${c.label}</text>\n`;
    svg += `    <text x="${c.x}" y="${c.y + 10}" class="nma-node-sub">N=${c.n.toLocaleString()}</text>\n`;
    svg += `  </g>\n`;
  });

  svg += `</svg>`;
  return svg;
}
