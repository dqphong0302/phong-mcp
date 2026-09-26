/**
 * Sensitivity & Subgroup Analysis Engine.
 * Implements:
 * 1. Leave-One-Out (Jackknife) Sensitivity Meta-Analysis & Robustness Index.
 * 2. Leave-One-Out Forest Plot SVG Generator.
 * 3. Stratified Subgroup Analysis & Test for Subgroup Differences (Q_between).
 * 
 * Standards:
 * - Cochrane Handbook for Systematic Reviews of Interventions (Chapter 10: Analysing data and undertaking meta-analyses).
 * - Borenstein et al. (2009). Introduction to Meta-Analysis.
 */

import { pValueFromZ, chiSquaredPValue } from "./meta-analysis.js";

/**
 * Standardize study data into log-scale effect (y) and standard error (se)
 */
function standardizeStudy(s, measure = "RR") {
  const isRatio = ["RR", "OR", "HR"].includes(measure.toUpperCase());
  let y = 0;
  let se = 0;
  let rawEffect = 1;

  // Case A: 2x2 contingency table data
  if (typeof s.e1 === "number" && typeof s.n1 === "number" && typeof s.e2 === "number" && typeof s.n2 === "number") {
    const e1 = s.e1 + 0.5;
    const n1 = s.n1 + 0.5;
    const e2 = s.e2 + 0.5;
    const n2 = s.n2 + 0.5;

    if (measure.toUpperCase() === "OR") {
      const or = (e1 * (n2 - e2)) / (e2 * (n1 - e1));
      y = Math.log(or);
      se = Math.sqrt(1 / e1 + 1 / (n1 - e1) + 1 / e2 + 1 / (n2 - e2));
      rawEffect = or;
    } else {
      // Default RR
      const r1 = e1 / n1;
      const r2 = e2 / n2;
      const rr = r1 / r2;
      y = Math.log(rr);
      se = Math.sqrt(1 / e1 - 1 / n1 + 1 / e2 - 1 / n2);
      rawEffect = rr;
    }
  }
  // Case B: Effect size with CI
  else if (typeof s.effect === "number" || typeof s.estimate === "number") {
    rawEffect = typeof s.effect === "number" ? s.effect : s.estimate;
    y = isRatio ? Math.log(rawEffect) : rawEffect;

    if (typeof s.se === "number" && s.se > 0) {
      se = s.se;
    } else if (typeof s.ciLow === "number" && typeof s.ciHigh === "number" && s.ciHigh > s.ciLow) {
      se = isRatio
        ? (Math.log(s.ciHigh) - Math.log(s.ciLow)) / (2 * 1.96)
        : (s.ciHigh - s.ciLow) / (2 * 1.96);
    } else {
      se = 0.2; // default fallback
    }
  }

  return {
    name: s.name || s.study || "Study",
    subgroup: s.subgroup || "Overall",
    rawEffect,
    y,
    se: Math.max(0.0001, se),
    weight: 1 / Math.max(0.0001, se * se),
  };
}

/**
 * DerSimonian-Laird random effects pooling
 */
function poolDerSimonianLaird(studies, isRatio = true) {
  const k = studies.length;
  if (k === 0) {
    return { effect: 1, ciLow: 1, ciHigh: 1, pValue: 1, q: 0, iSquared: 0, tau2: 0, se: 0, logEffect: 0 };
  }
  if (k === 1) {
    const s = studies[0];
    const ciLow = isRatio ? Math.exp(s.y - 1.96 * s.se) : s.y - 1.96 * s.se;
    const ciHigh = isRatio ? Math.exp(s.y + 1.96 * s.se) : s.y + 1.96 * s.se;
    const p = pValueFromZ(s.y / s.se);
    return {
      effect: isRatio ? Math.exp(s.y) : s.y,
      ciLow,
      ciHigh,
      pValue: p,
      q: 0,
      iSquared: 0,
      tau2: 0,
      se: s.se,
      logEffect: s.y,
    };
  }

  // 1. Fixed-effect weights
  let sumW = 0;
  let sumWY = 0;
  let sumW2 = 0;

  for (const s of studies) {
    const w = 1 / (s.se * s.se);
    sumW += w;
    sumWY += w * s.y;
    sumW2 += w * w;
  }

  const yFixed = sumWY / sumW;

  // 2. Cochran's Q
  let q = 0;
  for (const s of studies) {
    const w = 1 / (s.se * s.se);
    const diff = s.y - yFixed;
    q += w * diff * diff;
  }

  const df = k - 1;
  const qPValue = chiSquaredPValue(q, df);

  // 3. Tau^2 (DerSimonian-Laird)
  const c = sumW - sumW2 / sumW;
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;

  // 4. I^2 (%)
  const iSquared = q > df ? Math.max(0, Math.min(100, ((q - df) / q) * 100)) : 0;

  // 5. Random-effects weights
  let sumWRand = 0;
  let sumWYRand = 0;
  for (const s of studies) {
    const wRand = 1 / (s.se * s.se + tau2);
    sumWRand += wRand;
    sumWYRand += wRand * s.y;
  }

  const yRand = sumWYRand / sumWRand;
  const seRand = Math.sqrt(1 / sumWRand);
  const zRand = seRand > 0 ? yRand / seRand : 0;
  const pRand = pValueFromZ(zRand);

  const eff = isRatio ? Math.exp(yRand) : yRand;
  const ciLow = isRatio ? Math.exp(yRand - 1.96 * seRand) : yRand - 1.96 * seRand;
  const ciHigh = isRatio ? Math.exp(yRand + 1.96 * seRand) : yRand + 1.96 * seRand;

  return {
    effect: Number(eff.toFixed(3)),
    ciLow: Number(ciLow.toFixed(3)),
    ciHigh: Number(ciHigh.toFixed(3)),
    logEffect: Number(yRand.toFixed(4)),
    se: Number(seRand.toFixed(4)),
    zScore: Number(zRand.toFixed(3)),
    pValue: Number(pRand.toFixed(5)),
    q: Number(q.toFixed(2)),
    qPValue: Number(qPValue.toFixed(5)),
    df,
    iSquared: Number(iSquared.toFixed(1)),
    tau2: Number(tau2.toFixed(4)),
  };
}

/**
 * Perform Jackknife Leave-One-Out Sensitivity Analysis
 * @param {Array<Object>} rawStudies Array of study objects
 * @param {Object} [options]
 * @param {"RR"|"OR"|"HR"|"SMD"} [options.measure="RR"]
 * @param {string} [options.title]
 * @returns {Object} Complete Sensitivity Report with iterations and SVG plot
 */
export function runLeaveOneOutAnalysis(rawStudies = [], options = {}) {
  const {
    measure = "RR",
    title = "Leave-One-Out Sensitivity Analysis",
  } = options;

  const isRatio = ["RR", "OR", "HR"].includes(measure.toUpperCase());
  const studies = rawStudies.map((s) => standardizeStudy(s, measure));
  const k = studies.length;

  if (k < 3) {
    return {
      error: "Leave-One-Out sensitivity analysis requires at least 3 studies for meaningful robustness evaluation.",
    };
  }

  // 1. Overall baseline pooling
  const baseline = poolDerSimonianLaird(studies, isRatio);

  // 2. Iterations
  const iterations = [];
  let consistentSignificanceCount = 0;
  let maxEffectDelta = -1;
  let mostInfluentialStudy = "";
  let minISquared = 100;
  let heterogeneityDriver = "";

  for (let i = 0; i < k; i++) {
    const omitted = studies[i];
    const subset = studies.filter((_, idx) => idx !== i);
    const pooledWithout = poolDerSimonianLaird(subset, isRatio);

    const deltaEffect = Math.abs(pooledWithout.effect - baseline.effect);
    if (deltaEffect > maxEffectDelta) {
      maxEffectDelta = deltaEffect;
      mostInfluentialStudy = omitted.name;
    }

    if (pooledWithout.iSquared < minISquared) {
      minISquared = pooledWithout.iSquared;
      heterogeneityDriver = omitted.name;
    }

    const baselineSig = baseline.pValue < 0.05;
    const iterSig = pooledWithout.pValue < 0.05;
    const sameDirection = isRatio
      ? (baseline.effect < 1 && pooledWithout.effect < 1) || (baseline.effect > 1 && pooledWithout.effect > 1)
      : (baseline.effect < 0 && pooledWithout.effect < 0) || (baseline.effect > 0 && pooledWithout.effect > 0);

    const isRobust = iterSig === baselineSig && sameDirection;
    if (isRobust) consistentSignificanceCount++;

    iterations.push({
      omittedStudy: omitted.name,
      effect: pooledWithout.effect,
      ciLow: pooledWithout.ciLow,
      ciHigh: pooledWithout.ciHigh,
      pValue: pooledWithout.pValue,
      iSquared: pooledWithout.iSquared,
      q: pooledWithout.q,
      tau2: pooledWithout.tau2,
      deltaISquared: Number((pooledWithout.iSquared - baseline.iSquared).toFixed(1)),
      sameDirection,
      isRobust,
    });
  }

  const robustnessIndex = Math.round((consistentSignificanceCount / k) * 100);

  // Interpretation
  let verdict = "";
  if (robustnessIndex >= 90) {
    verdict = `Highly Robust (${robustnessIndex}%): The pooled effect remains statistically consistent regardless of omitting any single trial.`;
  } else if (robustnessIndex >= 70) {
    verdict = `Moderately Robust (${robustnessIndex}%): Results show moderate stability, but omission of certain trials (${mostInfluentialStudy}) impacts significance.`;
  } else {
    verdict = `Fragile (${robustnessIndex}%): Findings are fragile and heavily driven by single outlier trials. Interpret with caution.`;
  }

  // 3. Generate Forest Plot SVG
  const forestPlotSVG = generateLeaveOneOutForestPlotSVG({
    baseline,
    iterations,
    measure,
    title,
    robustnessIndex,
  });

  // 4. Markdown Report
  let markdown = `## ${title}\n\n`;
  markdown += `*Method: Jackknife Leave-One-Out Random-Effects Meta-Analysis (${k} iterations)*\n\n`;
  markdown += `### 🛡️ Overall Baseline & Robustness Assessment\n`;
  markdown += `- **Baseline Pooled Effect (${measure})**: **${baseline.effect} [${baseline.ciLow}, ${baseline.ciHigh}]** (p = ${baseline.pValue < 0.001 ? "< 0.001" : baseline.pValue}, $I^2 = ${baseline.iSquared}\\%$)\n`;
  markdown += `- **Robustness Index**: **${robustnessIndex}%** (${consistentSignificanceCount}/${k} iterations confirmed)\n`;
  markdown += `- **Most Influential Study**: **${mostInfluentialStudy}** (Max $\\Delta \\text{Effect} = ${maxEffectDelta.toFixed(3)}$)\n`;
  if (heterogeneityDriver && baseline.iSquared > 30) {
    markdown += `- **Primary Heterogeneity Driver**: **${heterogeneityDriver}** (Removal reduces $I^2$ to ${minISquared}%)\n`;
  }
  markdown += `- **Methodological Verdict**: **${verdict}**\n\n`;

  markdown += `### 📋 Leave-One-Out Iteration Matrix\n`;
  markdown += `| Omitted Study | Pooled ${measure} (95% CI) | p-value | $I^2$ (%) | $\\Delta I^2$ | Status |\n`;
  markdown += `|:---|:---:|:---:|:---:|:---:|:---:|\n`;
  for (const it of iterations) {
    const statusBadge = it.isRobust ? "🟢 Robust" : "🟡 Shifted";
    const deltaSign = it.deltaISquared > 0 ? `+${it.deltaISquared}%` : `${it.deltaISquared}%`;
    markdown += `| Omitting **${it.omittedStudy}** | ${it.effect} [${it.ciLow}, ${it.ciHigh}] | ${it.pValue < 0.001 ? "< 0.001" : it.pValue} | ${it.iSquared}% | ${deltaSign} | ${statusBadge} |\n`;
  }

  return {
    title,
    measure,
    totalStudies: k,
    baseline,
    robustnessIndex,
    mostInfluentialStudy,
    heterogeneityDriver,
    verdict,
    iterations,
    forestPlotSVG,
    markdown,
  };
}

/**
 * Generate Leave-One-Out Forest Plot SVG
 */
export function generateLeaveOneOutForestPlotSVG(params = {}) {
  const {
    baseline = {},
    iterations = [],
    measure = "RR",
    title = "Leave-One-Out Sensitivity Analysis",
    robustnessIndex = 100,
  } = params;

  const isRatio = ["RR", "OR", "HR"].includes(measure.toUpperCase());
  const rowHeight = 32;
  const headerHeight = 70;
  const numRows = iterations.length + 1; // +1 for baseline row
  const totalHeight = headerHeight + numRows * rowHeight + 90;
  const totalWidth = 840;

  const nameColWidth = 260;
  const plotLeft = 280;
  const plotWidth = 320;
  const statsColX = plotLeft + plotWidth + 30;

  // Determine X-axis scale min and max
  let allMin = baseline.ciLow;
  let allMax = baseline.ciHigh;
  for (const it of iterations) {
    if (it.ciLow < allMin) allMin = it.ciLow;
    if (it.ciHigh > allMax) allMax = it.ciHigh;
  }

  const nullVal = isRatio ? 1.0 : 0.0;
  let xMin = Math.min(allMin * 0.85, isRatio ? 0.2 : -1.0);
  let xMax = Math.max(allMax * 1.15, isRatio ? 2.0 : 1.0);

  // Transform value to X pixel coordinate
  function toX(val) {
    if (isRatio) {
      const logVal = Math.log(Math.max(0.01, val));
      const logMin = Math.log(Math.max(0.01, xMin));
      const logMax = Math.log(Math.max(0.01, xMax));
      return plotLeft + ((logVal - logMin) / (logMax - logMin)) * plotWidth;
    } else {
      return plotLeft + ((val - xMin) / (xMax - xMin)) * plotWidth;
    }
  }

  const nullX = toX(nullVal);
  const baselineX = toX(baseline.effect);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="${totalHeight}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">\n`;
  svg += `  <style>\n`;
  svg += `    .f-title { font-size: 16px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `    .f-sub { font-size: 12px; fill: #64748b; }\n`;
  svg += `    .f-label { font-size: 12px; fill: #334155; dominant-baseline: middle; }\n`;
  svg += `    .f-stat { font-size: 11px; fill: #475569; dominant-baseline: middle; }\n`;
  svg += `    .f-header { font-size: 12px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `  </style>\n`;

  // Background
  svg += `  <rect width="${totalWidth}" height="${totalHeight}" fill="#ffffff" rx="8"/>\n`;
  svg += `  <text x="24" y="30" class="f-title">${title}</text>\n`;
  svg += `  <text x="24" y="48" class="f-sub">Robustness Index: ${robustnessIndex}% • Dashed line: Baseline overall effect (${baseline.effect})</text>\n`;

  // Table Headers
  const headY = headerHeight - 10;
  svg += `  <text x="28" y="${headY}" class="f-header">Omitted Study</text>\n`;
  svg += `  <text x="${plotLeft + plotWidth / 2}" y="${headY}" class="f-header" text-anchor: middle>Effect Size (${measure}, 95% CI)</text>\n`;
  svg += `  <text x="${statsColX}" y="${headY}" class="f-header">${measure} [95% CI]</text>\n`;
  svg += `  <text x="${statsColX + 110}" y="${headY}" class="f-header">p-val</text>\n`;
  svg += `  <text x="${statsColX + 160}" y="${headY}" class="f-header">I²</text>\n`;

  svg += `  <line x1="20" y1="${headerHeight}" x2="${totalWidth - 20}" y2="${headerHeight}" stroke="#cbd5e1" stroke-width="1.5"/>\n`;

  // Reference lines
  const plotBottom = headerHeight + numRows * rowHeight;
  // Null effect solid line
  svg += `  <line x1="${nullX}" y1="${headerHeight}" x2="${nullX}" y2="${plotBottom}" stroke="#94a3b8" stroke-width="1.5"/>\n`;
  // Baseline dashed line
  svg += `  <line x1="${baselineX}" y1="${headerHeight}" x2="${baselineX}" y2="${plotBottom}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="4 3"/>\n`;

  // Rows
  iterations.forEach((it, idx) => {
    const y = headerHeight + (idx + 1) * rowHeight;
    const isEven = idx % 2 === 0;

    if (isEven) {
      svg += `  <rect x="20" y="${y - rowHeight / 2}" width="${totalWidth - 40}" height="${rowHeight}" fill="#f8fafc" rx="3"/>\n`;
    }

    const truncated = it.omittedStudy.length > 28 ? it.omittedStudy.substring(0, 26) + "…" : it.omittedStudy;
    svg += `  <text x="28" y="${y}" class="f-label"><title>Omitting ${it.omittedStudy}</title>Omitting <tspan font-weight="600">${truncated}</tspan></text>\n`;

    // CI Line
    const xLow = toX(it.ciLow);
    const xHigh = toX(it.ciHigh);
    const xEff = toX(it.effect);

    svg += `  <line x1="${xLow}" y1="${y}" x2="${xHigh}" y2="${y}" stroke="#475569" stroke-width="1.5"/>\n`;
    // Marker
    const pointColor = it.isRobust ? "#059669" : "#d97706";
    svg += `  <circle cx="${xEff}" cy="${y}" r="4" fill="${pointColor}" stroke="#ffffff" stroke-width="1">\n`;
    svg += `    <title>${it.effect} [${it.ciLow}, ${it.ciHigh}] (p=${it.pValue})</title>\n`;
    svg += `  </circle>\n`;

    // Stats
    svg += `  <text x="${statsColX}" y="${y}" class="f-stat">${it.effect} [${it.ciLow}, ${it.ciHigh}]</text>\n`;
    svg += `  <text x="${statsColX + 110}" y="${y}" class="f-stat">${it.pValue < 0.001 ? "<.001" : it.pValue}</text>\n`;
    svg += `  <text x="${statsColX + 160}" y="${y}" class="f-stat">${it.iSquared}%</text>\n`;
  });

  // Baseline Row at the bottom
  const baseRowY = headerHeight + numRows * rowHeight;
  svg += `  <line x1="20" y1="${baseRowY - rowHeight / 2}" x2="${totalWidth - 20}" y2="${baseRowY - rowHeight / 2}" stroke="#94a3b8" stroke-width="1"/>\n`;
  svg += `  <text x="28" y="${baseRowY}" class="f-label" font-weight="700" fill="#2563eb">Overall Combined Effect</text>\n`;

  const bLow = toX(baseline.ciLow);
  const bHigh = toX(baseline.ciHigh);
  const bEff = toX(baseline.effect);
  // Diamond
  svg += `  <polygon points="${bLow},${baseRowY} ${bEff},${baseRowY - 6} ${bHigh},${baseRowY} ${bEff},${baseRowY + 6}" fill="#2563eb"/>\n`;

  svg += `  <text x="${statsColX}" y="${baseRowY}" class="f-stat" font-weight="700" fill="#2563eb">${baseline.effect} [${baseline.ciLow}, ${baseline.ciHigh}]</text>\n`;
  svg += `  <text x="${statsColX + 110}" y="${baseRowY}" class="f-stat" font-weight="700" fill="#2563eb">${baseline.pValue < 0.001 ? "<.001" : baseline.pValue}</text>\n`;
  svg += `  <text x="${statsColX + 160}" y="${baseRowY}" class="f-stat" font-weight="700" fill="#2563eb">${baseline.iSquared}%</text>\n`;

  // Legend at bottom
  const legY = baseRowY + 30;
  svg += `  <text x="28" y="${legY}" font-size="11px" fill="#64748b">Favours Intervention ←</text>\n`;
  svg += `  <text x="${plotLeft + plotWidth}" y="${legY}" font-size="11px" fill="#64748b" text-anchor="end">→ Favours Control</text>\n`;

  svg += `</svg>`;
  return svg;
}

/**
 * Perform Stratified Subgroup Meta-Analysis with Q_between test
 * @param {Array<Object>} rawStudies Array of study objects with `subgroup` property
 * @param {Object} [options]
 * @returns {Object} Subgroup analysis results with Q_between test
 */
export function runSubgroupAnalysis(rawStudies = [], options = {}) {
  const {
    measure = "RR",
    title = "Stratified Subgroup Meta-Analysis",
  } = options;

  const isRatio = ["RR", "OR", "HR"].includes(measure.toUpperCase());
  const studies = rawStudies.map((s) => standardizeStudy(s, measure));

  // Group by subgroup
  const groups = {};
  for (const s of studies) {
    const gKey = s.subgroup || "Unclassified";
    if (!groups[gKey]) groups[gKey] = [];
    groups[gKey].push(s);
  }

  const groupKeys = Object.keys(groups);
  if (groupKeys.length < 2) {
    return { error: "Subgroup analysis requires at least 2 distinct subgroups." };
  }

  // Pool each subgroup
  let sumQWithin = 0;
  let totalStudies = 0;
  const subgroupResults = [];

  for (const g of groupKeys) {
    const pooled = poolDerSimonianLaird(groups[g], isRatio);
    sumQWithin += pooled.q;
    totalStudies += groups[g].length;

    subgroupResults.push({
      subgroup: g,
      k: groups[g].length,
      effect: pooled.effect,
      ciLow: pooled.ciLow,
      ciHigh: pooled.ciHigh,
      pValue: pooled.pValue,
      iSquared: pooled.iSquared,
      q: pooled.q,
      tau2: pooled.tau2,
    });
  }

  // Total pooling
  const overall = poolDerSimonianLaird(studies, isRatio);

  // Test for Subgroup Differences: Q_between = Q_total - sum(Q_within)
  const qBetween = Math.max(0, overall.q - sumQWithin);
  const dfBetween = groupKeys.length - 1;
  const pBetween = chiSquaredPValue(qBetween, dfBetween);

  let markdown = `## ${title}\n\n`;
  markdown += `### 📊 Subgroup Stratification Summary\n`;
  markdown += `| Subgroup | Studies (k) | Pooled ${measure} (95% CI) | p-value | $I^2$ (%) |\n`;
  markdown += `|:---|:---:|:---:|:---:|:---:|\n`;
  for (const sg of subgroupResults) {
    markdown += `| **${sg.subgroup}** | ${sg.k} | **${sg.effect} [${sg.ciLow}, ${sg.ciHigh}]** | ${sg.pValue < 0.001 ? "< 0.001" : sg.pValue} | ${sg.iSquared}% |\n`;
  }
  markdown += `| **Overall** | **${totalStudies}** | **${overall.effect} [${overall.ciLow}, ${overall.ciHigh}]** | **${overall.pValue < 0.001 ? "< 0.001" : overall.pValue}** | **${overall.iSquared}%** |\n\n`;

  markdown += `### 🧪 Test for Subgroup Differences\n`;
  markdown += `- **$Q_{\\text{between}}$**: **${qBetween.toFixed(2)}** (df = ${dfBetween})\n`;
  markdown += `- **$p_{\\text{between}}$**: **${pBetween < 0.001 ? "< 0.001" : pBetween.toFixed(4)}**\n`;
  if (pBetween < 0.05) {
    markdown += `- **Conclusion**: ✓ Statistically significant subgroup difference detected ($p < 0.05$). The treatment effect varies significantly across subgroups.\n`;
  } else {
    markdown += `- **Conclusion**: No statistically significant subgroup difference detected ($p \\ge 0.05$). The effect appears consistent across subgroups.\n`;
  }

  return {
    title,
    measure,
    subgroups: subgroupResults,
    overall,
    testForSubgroupDifferences: {
      qBetween: Number(qBetween.toFixed(2)),
      df: dfBetween,
      pValue: Number(pBetween.toFixed(5)),
      isSignificant: pBetween < 0.05,
    },
    markdown,
  };
}
