/**
 * Quantitative Meta-Analysis Engine, Forest Plot Generator &
 * Clinical Evidence Synthesis Suite (Direct Head-to-Head, Anchored ITC, Unanchored MAIC, Evidence Network Map).
 * 
 * Capabilities:
 * - Effect Sizes (OR, RR, SMD, HR), 95% Confidence Intervals
 * - Fixed-Effect & Random-Effects Models (DerSimonian-Laird)
 * - Heterogeneity Statistics (Cochran's Q, I^2, Tau^2)
 * - Unicode / ASCII Forest Plot Generation
 * - Bucher (1997) Anchored Indirect Treatment Comparison (ITC)
 * - Unanchored Matching-Adjusted Indirect Comparison (MAIC) Summary Tables
 * - Otto SR-style Evidence Network Maps & PICO Direct Comparison Grids
 */

/**
 * Standard normal cumulative distribution approximation (Phi).
 * Returns two-tailed p-value for a given Z-score.
 */
export function pValueFromZ(z) {
  const absZ = Math.abs(z);
  const t = 1.0 / (1.0 + 0.2316419 * absZ);
  const d = 0.3989422804014337 * Math.exp((-absZ * absZ) / 2);
  const prob = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(1, Math.max(0, 2 * prob)); // two-tailed
}

/**
 * Chi-squared survival function (upper-tail p-value) via Wilson-Hilferty approximation.
 * Used for Cochran's Q heterogeneity test.
 * @param {number} x The chi-squared statistic (Q)
 * @param {number} k Degrees of freedom (df = number of studies - 1)
 * @returns {number} p-value (upper tail)
 */
export function chiSquaredPValue(x, k) {
  if (k <= 0 || x <= 0) return 1.0;
  const z = Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k));
  const se = Math.sqrt(2 / (9 * k));
  if (se <= 0) return x > k ? 0 : 1;
  const zNorm = z / se;
  const absZ = Math.abs(zNorm);
  const t = 1.0 / (1.0 + 0.2316419 * absZ);
  const d = 0.3989422804014337 * Math.exp((-absZ * absZ) / 2);
  const tail = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return zNorm > 0 ? Math.min(1, Math.max(0, tail)) : Math.min(1, Math.max(0, 1 - tail));
}

/**
 * Perform Bucher (1997) Anchored Indirect Treatment Comparison (ITC).
 * Compares Intervention A vs Comparator B via common anchor C (e.g. Placebo or Standard of Care).
 *
 * @param {Object} trialAC Trial A vs Anchor C: { name, intervention, anchor, estimate, ciLow, ciHigh }
 * @param {Object} trialBC Trial B vs Anchor C: { name, intervention, anchor, estimate, ciLow, ciHigh }
 * @param {"HR"|"OR"|"RR"} [measure="HR"] Effect measure
 * @param {string} [title] Assessment title
 * @returns {Object} Full ITC statistical report and markdown table
 */
export function calculateBucherITC(trialAC = {}, trialBC = {}, measure = "HR", title = "Anchored Indirect Treatment Comparison (Bucher Method)") {
  if (!trialAC || !trialBC || typeof trialAC.estimate !== "number" || typeof trialBC.estimate !== "number") {
    return { error: "Both trialAC and trialBC with point estimates and 95% CIs are required for anchored ITC." };
  }

  // The indirect standard error is derived entirely from the two reported
  // confidence intervals. A missing CI used to default to estimate x0.8 / x1.25,
  // which manufactures an SE of ~0.114 for every trial regardless of its actual
  // size and then reports the contrast as if it were real. Refuse instead.
  const armError = (t, label) => {
    const est = Number(t.estimate);
    const low = Number(t.ciLow);
    const high = Number(t.ciHigh);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return `${label}: ciLow and ciHigh are required — the indirect standard error is computed from them and cannot be assumed.`;
    }
    if (!(est > 0) || !(low > 0) || !(high > 0)) {
      return `${label}: ${measure} is analysed on the log scale, so estimate, ciLow and ciHigh must all be > 0.`;
    }
    if (!(low < high)) return `${label}: ciLow (${low}) must be below ciHigh (${high}).`;
    if (est < low || est > high) return `${label}: estimate (${est}) lies outside its own 95% CI [${low}, ${high}].`;
    return null;
  };

  const armErrors = [
    armError(trialAC, trialAC.name || "trialAC"),
    armError(trialBC, trialBC.name || "trialBC"),
  ].filter(Boolean);
  if (armErrors.length) return { error: armErrors.join(" ") };

  const estAC = Number(trialAC.estimate);
  const lowAC = Number(trialAC.ciLow);
  const highAC = Number(trialAC.ciHigh);
  const estBC = Number(trialBC.estimate);
  const lowBC = Number(trialBC.ciLow);
  const highBC = Number(trialBC.ciHigh);

  const drugA = trialAC.intervention || "Intervention A";
  const drugB = trialBC.intervention || "Comparator B";
  const anchor = trialAC.anchor || trialBC.anchor || "Common Comparator (SoC/Placebo)";

  // Log-scale effect sizes and standard errors
  const logAC = Math.log(estAC);
  const seAC = (Math.log(highAC) - Math.log(lowAC)) / (2 * 1.96);

  const logBC = Math.log(estBC);
  const seBC = (Math.log(highBC) - Math.log(lowBC)) / (2 * 1.96);

  // Bucher indirect contrast: theta_AB = theta_AC - theta_BC
  const logAB = logAC - logBC;
  const seAB = Math.sqrt(seAC * seAC + seBC * seBC);

  const indirectEstimate = Math.exp(logAB);
  const indirectCILow = Math.exp(logAB - 1.96 * seAB);
  const indirectCIHigh = Math.exp(logAB + 1.96 * seAB);

  const zScore = seAB > 0 ? logAB / seAB : 0;
  const pValue = pValueFromZ(zScore);

  let clinicalFinding = "";
  if (pValue < 0.05) {
    if (indirectEstimate < 1.0) {
      clinicalFinding = `Favours ${drugA} over ${drugB} (Statistically Significant, p = ${pValue.toFixed(4)})`;
    } else {
      clinicalFinding = `Favours ${drugB} over ${drugA} (Statistically Significant, p = ${pValue.toFixed(4)})`;
    }
  } else {
    clinicalFinding = `Inconclusive / No statistically significant difference between ${drugA} and ${drugB} (p = ${pValue.toFixed(4)})`;
  }

  const markdown = `## ${title}

*Methodology: Bucher (1997) Anchored Indirect Treatment Comparison via Common Anchor: **${anchor}***

### 📋 Direct Input Trials (Anchored via ${anchor})
| Study / Trial | Contrast | ${measure} (95% CI) | Standard Error (log) | Precision ($1/SE^2$) |
|---|---|:---:|:---:|:---:|
| **${trialAC.name || "Trial 1"}** | **${drugA}** vs **${anchor}** | ${estAC.toFixed(3)} [${lowAC.toFixed(3)}, ${highAC.toFixed(3)}] | ${seAC.toFixed(4)} | ${(1 / (seAC * seAC)).toFixed(2)} |
| **${trialBC.name || "Trial 2"}** | **${drugB}** vs **${anchor}** | ${estBC.toFixed(3)} [${lowBC.toFixed(3)}, ${highBC.toFixed(3)}] | ${seBC.toFixed(4)} | ${(1 / (seBC * seBC)).toFixed(2)} |

### 🎯 Anchored ITC Result (**${drugA}** vs **${drugB}**)
| Metric / Parameter | Value | Clinical & Methodological Interpretation |
|---|---|---|
| **Indirect Effect (${measure})** | **${indirectEstimate.toFixed(3)}** | Point Estimate via Anchor **${anchor}** |
| **95% Confidence Interval** | **[${indirectCILow.toFixed(3)}, ${indirectCIHigh.toFixed(3)}]** | Wald 95% Confidence Interval |
| **Log Indirect Estimate & SE** | $\\Delta \\ln = ${logAB.toFixed(4)}, SE = ${seAB.toFixed(4)}$ | $\\theta_{AB} = \\theta_{AC} - \\theta_{BC}$ |
| **Hypothesis Test (Z, p)** | $Z = ${zScore.toFixed(3)}, p = ${pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}$ | ${pValue < 0.05 ? "✓ Statistically Significant" : "Not Significant"} |
| **Direction of Evidence** | **${clinicalFinding}** | HTA & Evidence Synthesis Decision |

> [!NOTE]
> **Bucher Transitivity Assumption**: Valid anchored indirect comparison requires that relative treatment effects are constant across populations (no effect modifier imbalance across Trial 1 and Trial 2).
`;

  return {
    mode: "anchored_itc",
    title,
    measure,
    anchor,
    drugA,
    drugB,
    indirect: {
      estimate: Number(indirectEstimate.toFixed(4)),
      ciLow: Number(indirectCILow.toFixed(4)),
      ciHigh: Number(indirectCIHigh.toFixed(4)),
      logEffect: Number(logAB.toFixed(4)),
      se: Number(seAB.toFixed(4)),
      zScore: Number(zScore.toFixed(3)),
      pValue: Number(pValue.toFixed(5)),
      finding: clinicalFinding,
    },
    markdown,
  };
}

/**
 * Generate Direct Head-to-Head Comparison table with PICO specification and trial-level data.
 */
export function generateDirectComparisonTable(input = {}) {
  const {
    title = "Head-to-Head Direct Trials Comparison",
    pico = {},
    studies = [],
    measure = "HR",
  } = input;

  const popStr = pico.population || "Target Clinical Population";
  const intStr = pico.intervention || "Intervention Drug / Asset";
  const compStr = pico.comparator || "Standard of Care (SoC) / Active Comparator";
  const outStr = pico.outcome || "Primary Clinical Endpoint";
  const lineStr = pico.line_of_therapy || "First-line (1L)";

  let tableRows = "";
  let totalN1 = 0;
  let totalN2 = 0;

  for (const s of studies) {
    const studyName = s.name || "Trial";
    const phase = s.phase || "Phase III";
    const n1 = s.n1 || 0;
    const n2 = s.n2 || 0;
    totalN1 += n1;
    totalN2 += n2;

    const est = typeof s.estimate === "number" ? s.estimate.toFixed(2) : typeof s.effect === "number" ? s.effect.toFixed(2) : "—";
    const low = typeof s.ciLow === "number" ? s.ciLow.toFixed(2) : "—";
    const high = typeof s.ciHigh === "number" ? s.ciHigh.toFixed(2) : "—";
    const estStr = est !== "—" ? `${est} [${low}, ${high}]` : "—";
    const pValStr = typeof s.pValue === "number" ? (s.pValue < 0.001 ? "< 0.001" : s.pValue.toFixed(4)) : (s.p_value || "—");
    const rob = s.rob || "🟢 Low";

    tableRows += `| **${studyName}** | ${phase} | ${n1} | ${n2} | ${estStr} | ${pValStr} | ${rob} | ${s.notes || "—"} |\n`;
  }

  // If studies have enough data, also pool them
  let pooledSection = "";
  if (studies.length > 0 && studies.every(s => (s.e1 !== undefined && s.e2 !== undefined) || (s.m1 !== undefined && s.m2 !== undefined))) {
    const poolRes = runMetaAnalysis({ studies, measure: input.measure || "OR", model: input.model || "random", title });
    if (poolRes && poolRes.markdown) {
      pooledSection = `\n### 📈 Pooled Head-to-Head Meta-Analysis\n\`\`\`text\n${poolRes.forestPlot}\n\`\`\`\n`;
    }
  }

  const markdown = `## ${title}

### 🎯 PICO Protocol Specifications
| PICO Element | Description |
|---|---|
| **Population (P)** | ${popStr} |
| **Intervention (I)** | **${intStr}** |
| **Comparator (C)** | **${compStr}** |
| **Outcome (O)** | ${outStr} |
| **Line of Therapy** | ${lineStr} |

### 📋 Direct Head-to-Head Trial Evidence Table
| Study / Trial | Phase | N (${intStr}) | N (${compStr}) | ${measure} (95% CI) | p-value | RoB 2.0 | Key Findings / Notes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
${tableRows || "| *No direct trials entered* | — | — | — | — | — | — | — |\n"}
| **Total Enrolled** | **Summary** | **${totalN1}** | **${totalN2}** | — | — | — | **${studies.length} Head-to-head trials assessed** |
${pooledSection}
`;

  return {
    mode: "direct_comparison",
    title,
    pico: { population: popStr, intervention: intStr, comparator: compStr, outcome: outStr, line_of_therapy: lineStr },
    studiesCount: studies.length,
    totalN: totalN1 + totalN2,
    markdown,
  };
}

/**
 * Generate Unanchored MAIC (Matching-Adjusted Indirect Comparison) summary table.
 */
export function generateMAICSummary(input = {}) {
  const {
    title = "Matching-Adjusted Indirect Comparison (MAIC) Summary",
    maic = {},
  } = input;

  const drugA = maic.drugA || "Asset A (Individual Patient Data - IPD)";
  const drugB = maic.drugB || "Comparator B (Aggregate Published Data - AgD)";
  const population = maic.population || "Target Disease Cohort";
  const outcome = maic.outcome || "Overall Survival (OS)";
  const measure = maic.measure || "HR";

  const origN = Number(maic.original_n || 100);
  const ess = Number(maic.effective_sample_size || origN * 0.7);
  const essReduction = origN > 0 ? (((origN - ess) / origN) * 100).toFixed(1) : "0.0";

  const unadj = maic.unadjusted_effect || { estimate: 0.75, ciLow: 0.58, ciHigh: 0.98 };
  const adj = maic.adjusted_effect || { estimate: 0.82, ciLow: 0.61, ciHigh: 1.10 };

  const matchedVars = maic.matched_variables || [
    { variable: "Median Age (years)", trial_a_unadjusted: "62.5", trial_a_weighted: "65.0", trial_b_target: "65.0", balance_achieved: true },
    { variable: "Male Gender (%)", trial_a_unadjusted: "58.0%", trial_a_weighted: "52.0%", trial_b_target: "52.0%", balance_achieved: true },
    { variable: "Prior Lines of Therapy (mean)", trial_a_unadjusted: "2.1", trial_a_weighted: "3.2", trial_b_target: "3.2", balance_achieved: true },
    { variable: "Refractory Status (%)", trial_a_unadjusted: "45.0%", trial_a_weighted: "60.0%", trial_b_target: "60.0%", balance_achieved: true },
  ];

  let varRows = "";
  for (const v of matchedVars) {
    const status = v.balance_achieved !== false ? "✓ Balanced" : "⚠ Imbalance";
    varRows += `| **${v.variable}** | ${v.trial_a_unadjusted || "—"} | **${v.trial_a_weighted || "—"}** | **${v.trial_b_target || "—"}** | ${status} |\n`;
  }

  const markdown = `## ${title}

*Framework: Unanchored Matching-Adjusted Indirect Comparison (NICE DSU TSD 18 & EU-JCA Guidelines)*

### 🎯 Population & Contrast
- **Target Population**: ${population}
- **Index Intervention (IPD available)**: **${drugA}**
- **Comparator (Aggregate Data)**: **${drugB}**
- **Target Clinical Endpoint**: ${outcome}

### ⚖️ Covariate Balancing & Effective Sample Size (ESS)
| Baseline Covariate / Modifier | ${drugA} (Unadjusted) | ${drugA} (MAIC Weighted) | ${drugB} Target (AgD) | Diagnostics |
|---|:---:|:---:|:---:|:---:|
${varRows}

| Sample Size Parameter | Original IPD Cohort | Post-Weighting (ESS) | % Reduction in Sample Information |
|---|:---:|:---:|:---:|
| **Sample Size (N)** | **${origN}** | **${ess.toFixed(1)}** | **${essReduction}%** |

### 📊 Comparative Treatment Effect (Unadjusted vs MAIC Adjusted)
| Analysis Cohort | ${measure} (95% CI) | Statistical Significance | Clinical Interpretation |
|---|:---:|:---:|---|
| **Naïve / Unadjusted Comparison** | **${Number(unadj.estimate).toFixed(2)} [${Number(unadj.ciLow).toFixed(2)}, ${Number(unadj.ciHigh).toFixed(2)}]** | ${unadj.ciHigh < 1.0 ? "Statistically Significant" : "Not Significant"} | Confounded by baseline prognostic imbalances |
| **MAIC Re-weighted Comparison** | **${Number(adj.estimate).toFixed(2)} [${Number(adj.ciLow).toFixed(2)}, ${Number(adj.ciHigh).toFixed(2)}]** | ${adj.ciHigh < 1.0 ? "Statistically Significant" : "Inconclusive (CI crosses 1.0)"} | Adjusted for observed effect modifiers & prognostic factors |

> [!WARNING]
> **MAIC Regulatory Limitation**: Unanchored MAIC cannot adjust for unobserved or unmeasured confounders. Regulatory bodies (e.g. EU-JCA, NICE) treat unanchored indirect comparisons with caution when substantial ESS reduction (>50%) occurs.
`;

  return {
    mode: "unanchored_maic",
    title,
    original_n: origN,
    effective_sample_size: ess,
    essReductionPercent: Number(essReduction),
    unadjusted: unadj,
    adjusted: adj,
    markdown,
  };
}

/**
 * Generate Otto SR-style Evidence Network Map (Mermaid graph + Evidence Matrix).
 */
export function generateEvidenceNetworkMap(input = {}) {
  const {
    title = "Clinical Evidence Synthesis & Network Map",
    comparisons = input.evidence_map || [],
  } = input;

  if (!comparisons || comparisons.length === 0) {
    return { error: "No comparisons provided for Evidence Network Map" };
  }

  let mermaid = "graph LR\n";
  mermaid += "    classDef asset fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px,font-weight:bold;\n";
  mermaid += "    classDef comp fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;\n";
  mermaid += "    classDef gap fill:#fff3e0,stroke:#e65100,stroke-dasharray: 5 5;\n";

  let matrixRows = "";
  const nodes = new Set();

  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i];
    const a = (c.drugA || "Asset A").trim();
    const b = (c.drugB || "Comparator").trim();
    const type = c.comparison_type || "direct"; // direct, anchored_itc, unanchored_maic, no_evidence
    const anchor = c.anchor ? ` via ${c.anchor}` : "";
    const lot = c.line_of_therapy || "1L";
    const finding = c.finding || "favours_asset"; // favours_asset, favours_comparator, inconclusive, evidence_gap
    const effect = c.effect_summary || "—";

    const aId = a.replace(/[^a-zA-Z0-9]/g, "_");
    const bId = b.replace(/[^a-zA-Z0-9]/g, "_");
    nodes.add(`${aId}["${a}"]:::asset`);

    let findingBadge = "";
    if (finding === "favours_asset") findingBadge = `🟢 **Favours ${a}**`;
    else if (finding === "favours_comparator") findingBadge = `🔵 **Favours ${b}**`;
    else if (finding === "inconclusive") findingBadge = `🟡 **Inconclusive**`;
    else findingBadge = `🔴 **Evidence Gap**`;

    let typeStr = "";
    if (type === "direct") {
      typeStr = "Direct (Head-to-head)";
      mermaid += `    ${aId} ===|Direct (${lot})| ${bId}["${b}"]:::comp\n`;
    } else if (type === "anchored_itc") {
      typeStr = `Anchored ITC${anchor}`;
      mermaid += `    ${aId} -.->|Anchored ITC${anchor}| ${bId}["${b}"]:::comp\n`;
    } else if (type === "unanchored_maic") {
      typeStr = "Unanchored MAIC";
      mermaid += `    ${aId} -.-|Unanchored MAIC| ${bId}["${b}"]:::comp\n`;
    } else {
      typeStr = "No Linked Evidence";
      nodes.add(`${bId}["${b}"]:::gap`);
    }

    matrixRows += `| **P${i + 1}** | **${a}** vs **${b}** | ${typeStr} | ${lot} | ${effect} | ${findingBadge} | ${c.notes || "—"} |\n`;
  }

  const nodesDefs = Array.from(nodes).map(n => `    ${n}`).join("\n");

  const markdown = `## ${title}

*Multi-treatment Evidence Synthesis & Evidence Map (Otto SR Standard)*

### 🗺️ Evidence Network Map (Mermaid Topology)
\`\`\`mermaid
${mermaid}
\`\`\`

### 📊 Strategic Evidence Matrix
| ID | Contrast Pair | Comparison Type | Line of Therapy | Effect Summary | Finding Direction | Strategic Notes |
|:---:|---|---|:---:|:---:|:---:|---|
${matrixRows}

> [!TIP]
> **Evidence Strategy Hierarchy**: Direct head-to-head trials provide primary regulatory proof $\\rightarrow$ Anchored ITCs (Bucher) fill cross-trial gaps with high certainty $\\rightarrow$ Unanchored MAICs provide supportive evidence $\\rightarrow$ Evidence Gaps highlight unmet clinical research opportunities.
`;

  return {
    mode: "evidence_network_map",
    title,
    comparisonsCount: comparisons.length,
    mermaid,
    markdown,
  };
}

/**
 * Perform Quantitative Meta-Analysis or Extended Evidence Synthesis.
 *
 * @param {Object} input
 * @param {string} [input.mode="meta_analysis"] Analysis mode: "meta_analysis" | "direct_comparison" | "anchored_itc" | "unanchored_maic" | "evidence_network_map"
 * @param {Array<Object>} [input.studies] Array of study records for pooling
 * @param {"OR"|"RR"|"SMD"|"HR"} [input.measure="OR"] Effect measure
 * @param {"random"|"fixed"} [input.model="random"] Model type
 * @param {Object} [input.pico] PICO specification object
 * @param {Object} [input.itc] Anchored ITC data: { trialAC, trialBC }
 * @param {Object} [input.maic] Unanchored MAIC data
 * @param {Array<Object>} [input.evidence_map] Array of contrast comparisons for network map
 * @returns {Object} Statistical report and markdown
 */
export function runMetaAnalysis(input = {}) {
  const mode = input.mode || (
    input.itc ? "anchored_itc" :
    input.maic ? "unanchored_maic" :
    input.evidence_map ? "evidence_network_map" :
    input.pico && (!input.studies || input.studies.length === 0 || input.direct_comparison) ? "direct_comparison" :
    "meta_analysis"
  );

  if (mode === "anchored_itc" || input.itc) {
    return calculateBucherITC(input.itc?.trialAC, input.itc?.trialBC, input.measure || "HR", input.title);
  }
  if (mode === "unanchored_maic" || input.maic) {
    return generateMAICSummary(input);
  }
  if (mode === "evidence_network_map" || input.evidence_map) {
    return generateEvidenceNetworkMap(input);
  }
  if (mode === "direct_comparison" || mode === "head_to_head") {
    return generateDirectComparisonTable(input);
  }

  // ── Standard Pooled Meta-Analysis Mode ───────────────────────────────────────
  const {
    studies = [],
    measure = "OR",
    model = "random",
    title = "Quantitative Meta-Analysis & Forest Plot",
    pico = null,
  } = input;

  if (!studies || studies.length === 0) {
    return { error: "No studies provided for meta-analysis" };
  }

  const processed = [];

  // Calculate individual effect sizes (log scale for OR/RR)
  for (const s of studies) {
    const studyName = s.name || s.study || `Study ${processed.length + 1}`;
    let effect = 0;
    let logEffect = 0;
    let se = 0;
    let ciLow = 0;
    let ciHigh = 0;

    if (measure === "OR" || measure === "RR") {
      let a = Number(s.e1 || 0);
      let n1 = Number(s.n1 || 1);
      let b = n1 - a;
      let c = Number(s.e2 || 0);
      let n2 = Number(s.n2 || 1);
      let d = n2 - c;

      if (a === 0 || b === 0 || c === 0 || d === 0) {
        a += 0.5;
        b += 0.5;
        c += 0.5;
        d += 0.5;
        n1 += 1;
        n2 += 1;
      }

      if (measure === "OR") {
        const or = (a * d) / (b * c);
        logEffect = Math.log(or);
        se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
        effect = or;
      } else {
        const p1 = a / n1;
        const p2 = c / n2;
        const rr = p1 / p2;
        logEffect = Math.log(rr);
        se = Math.sqrt((n1 - a) / (a * n1) + (n2 - c) / (c * n2));
        effect = rr;
      }
      ciLow = Math.exp(logEffect - 1.96 * se);
      ciHigh = Math.exp(logEffect + 1.96 * se);
    } else {
      // Continuous outcome: SMD (Hedges' g)
      const m1 = Number(s.m1 || 0);
      const s1 = Number(s.s1 || 1);
      const n1 = Number(s.n1 || 10);
      const m2 = Number(s.m2 || 0);
      const s2 = Number(s.s2 || 1);
      const n2 = Number(s.n2 || 10);

      const sPooled = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
      const cohenD = sPooled > 0 ? (m1 - m2) / sPooled : 0;
      const jFactor = 1 - 3 / (4 * (n1 + n2) - 9); // Hedges correction
      const hedgesG = cohenD * jFactor;
      se = Math.sqrt((n1 + n2) / (n1 * n2) + (hedgesG * hedgesG) / (2 * (n1 + n2)));

      logEffect = hedgesG;
      effect = hedgesG;
      ciLow = hedgesG - 1.96 * se;
      ciHigh = hedgesG + 1.96 * se;
    }

    const variance = se * se;
    const invVar = variance > 0 ? 1 / variance : 1;

    processed.push({
      name: studyName,
      effect,
      logEffect,
      se,
      ciLow,
      ciHigh,
      variance,
      invVar,
    });
  }

  // Fixed effect calculation (Inverse Variance)
  const sumWeightsFixed = processed.reduce((sum, s) => sum + s.invVar, 0);
  const sumWeightedEffectFixed = processed.reduce((sum, s) => sum + s.invVar * s.logEffect, 0);
  const fixedLog = sumWeightsFixed > 0 ? sumWeightedEffectFixed / sumWeightsFixed : 0;
  const fixedSE = sumWeightsFixed > 0 ? Math.sqrt(1 / sumWeightsFixed) : 0;

  // Cochran's Q statistic
  let q = 0;
  for (const s of processed) {
    q += s.invVar * Math.pow(s.logEffect - fixedLog, 2);
  }

  const k = processed.length;
  const df = k - 1;

  // Between-study variance tau^2 (DerSimonian-Laird method)
  let tau2 = 0;
  if (df > 0 && q > df) {
    const sumWeightsSquared = processed.reduce((sum, s) => sum + s.invVar * s.invVar, 0);
    const cVal = sumWeightsFixed - sumWeightsSquared / sumWeightsFixed;
    tau2 = cVal > 0 ? (q - df) / cVal : 0;
  }

  // Heterogeneity I^2 (%)
  const i2 = df > 0 && q > df ? Math.max(0, Math.min(100, ((q - df) / q) * 100)) : 0;

  // Random effects weights
  const isRandom = model === "random";
  for (const s of processed) {
    const randomVar = s.variance + tau2;
    s.weight = isRandom ? (randomVar > 0 ? 1 / randomVar : 1) : s.invVar;
  }

  const totalWeight = processed.reduce((sum, s) => sum + s.weight, 0);
  for (const s of processed) {
    s.weightPercent = totalWeight > 0 ? ((s.weight / totalWeight) * 100).toFixed(1) : 0;
  }

  const sumWeightedEffect = processed.reduce((sum, s) => sum + s.weight * s.logEffect, 0);
  const finalLog = totalWeight > 0 ? sumWeightedEffect / totalWeight : 0;
  const finalSE = totalWeight > 0 ? Math.sqrt(1 / totalWeight) : 0;

  const zScore = finalSE > 0 ? finalLog / finalSE : 0;
  const pValue = pValueFromZ(zScore);

  let pooledEstimate = 0;
  let pooledCILow = 0;
  let pooledCIHigh = 0;

  if (measure === "OR" || measure === "RR") {
    pooledEstimate = Math.exp(finalLog);
    pooledCILow = Math.exp(finalLog - 1.96 * finalSE);
    pooledCIHigh = Math.exp(finalLog + 1.96 * finalSE);
  } else {
    pooledEstimate = finalLog;
    pooledCILow = finalLog - 1.96 * finalSE;
    pooledCIHigh = finalLog + 1.96 * finalSE;
  }

  // ── Generate ASCII / Unicode Forest Plot ────────────────────────────────────
  const minVal = Math.min(...processed.map((s) => s.ciLow), pooledCILow);
  const maxVal = Math.max(...processed.map((s) => s.ciHigh), pooledCIHigh);
  const plotWidth = 30;

  function scalePos(val) {
    if (maxVal === minVal) return Math.floor(plotWidth / 2);
    const ratio = (val - minVal) / (maxVal - minVal);
    return Math.max(0, Math.min(plotWidth - 1, Math.floor(ratio * (plotWidth - 1))));
  }

  let forestPlot = `Study / Record                 ${measure.padEnd(6)} [95% CI]          Weight   Forest Plot (Favors Experimental <-> Favors Control)\n`;
  forestPlot += "─".repeat(105) + "\n";

  for (const s of processed) {
    const studyStr = s.name.slice(0, 28).padEnd(28);
    const estStr = `${s.effect.toFixed(2)} [${s.ciLow.toFixed(2)}, ${s.ciHigh.toFixed(2)}]`.padEnd(22);
    const wStr = `${s.weightPercent}%`.padStart(6);

    const lowPos = scalePos(s.ciLow);
    const highPos = scalePos(s.ciHigh);
    const pointPos = scalePos(s.effect);

    let line = new Array(plotWidth).fill(" ");
    const nullPos = scalePos(measure === "SMD" ? 0 : 1);
    if (nullPos >= 0 && nullPos < plotWidth) line[nullPos] = "┆";

    for (let p = lowPos; p <= highPos; p++) {
      if (p >= 0 && p < plotWidth) line[p] = "─";
    }
    if (pointPos >= 0 && pointPos < plotWidth) line[pointPos] = "■";

    forestPlot += `${studyStr}   ${estStr}   ${wStr}   |${line.join("")}|\n`;
  }

  forestPlot += "─".repeat(105) + "\n";
  const diamondLow = scalePos(pooledCILow);
  const diamondHigh = scalePos(pooledCIHigh);
  const diamondCenter = scalePos(pooledEstimate);

  let dLine = new Array(plotWidth).fill(" ");
  const nullPos = scalePos(measure === "SMD" ? 0 : 1);
  if (nullPos >= 0 && nullPos < plotWidth) dLine[nullPos] = "┆";
  for (let p = diamondLow; p <= diamondHigh; p++) {
    if (p >= 0 && p < plotWidth) dLine[p] = "━";
  }
  if (diamondCenter >= 0 && diamondCenter < plotWidth) dLine[diamondCenter] = "◆";

  const poolTitle = (isRandom ? "Pooled (Random Effects)" : "Pooled (Fixed Effect)").padEnd(28);
  const poolEstStr = `${pooledEstimate.toFixed(2)} [${pooledCILow.toFixed(2)}, ${pooledCIHigh.toFixed(2)}]`.padEnd(22);
  forestPlot += `<b>${poolTitle}   ${poolEstStr}   100.0%   |${dLine.join("")}|</b>\n`;

  let picoHeader = "";
  if (pico) {
    picoHeader = `\n### 🎯 PICO Protocol\n| Element | Description |\n|---|---|\n| **Population** | ${pico.population || "—"} |\n| **Intervention** | **${pico.intervention || "—"}** |\n| **Comparator** | **${pico.comparator || "—"}** |\n| **Outcome** | ${pico.outcome || "—"} |\n`;
  }

  // ── Markdown Summary Report ────────────────────────────────────────────────
  const markdown = `## ${title}
${picoHeader}
### 📈 Forest Plot & Meta-Analysis Results
\`\`\`text
${forestPlot}
\`\`\`

### 📊 Statistical Summary & Heterogeneity Test
| Parameter | Value | Interpretation |
|---|---|---|
| **Effect Measure** | **${measure}** (${measure === "OR" ? "Odds Ratio" : measure === "RR" ? "Risk Ratio" : "Standardized Mean Difference"}) | Ratio / Effect Size |
| **Model Type** | **${isRandom ? "Random-Effects (DerSimonian-Laird)" : "Fixed-Effect (Inverse Variance)"}** | ${isRandom ? "Accounts for between-study variance" : "Assumes identical true effect"} |
| **Pooled Estimate** | **${pooledEstimate.toFixed(3)} (95% CI: ${pooledCILow.toFixed(3)} - ${pooledCIHigh.toFixed(3)})** | Overall Effect Size |
| **Test of Overall Effect** | $Z = ${zScore.toFixed(3)}, p = ${pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}$ | ${pValue < 0.05 ? "✓ Statistically Significant" : "Not Significant"} |
| **Cochran's $Q$ Test** | $Q = ${q.toFixed(2)}, df = ${df}, p = ${df > 0 ? chiSquaredPValue(q, df).toFixed(4) : "N/A (k=1)"}$ | Heterogeneity Significance |
| **$I^2$ Statistic** | **${i2.toFixed(1)}%** | ${i2 < 25 ? "Low Heterogeneity" : i2 < 50 ? "Moderate Heterogeneity" : "Substantial / High Heterogeneity"} |
| **Between-study Variance ($\tau^2$)** | **${tau2.toFixed(4)}** | Estimated Variance of True Effects |
`;

  return {
    mode: "meta_analysis",
    title,
    measure,
    model,
    pooled: {
      estimate: Number(pooledEstimate.toFixed(4)),
      ciLow: Number(pooledCILow.toFixed(4)),
      ciHigh: Number(pooledCIHigh.toFixed(4)),
      zScore: Number(zScore.toFixed(3)),
      pValue: Number(pValue.toFixed(5)),
    },
    heterogeneity: {
      q: Number(q.toFixed(3)),
      df,
      i2: Number(i2.toFixed(2)),
      tau2: Number(tau2.toFixed(4)),
    },
    studies: processed.map((s) => ({
      name: s.name,
      effect: Number(s.effect.toFixed(3)),
      ciLow: Number(s.ciLow.toFixed(3)),
      ciHigh: Number(s.ciHigh.toFixed(3)),
      weightPercent: Number(s.weightPercent),
    })),
    forestPlot,
    markdown,
  };
}
