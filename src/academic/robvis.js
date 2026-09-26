/**
 * Cochrane Risk of Bias (RoB 2.0 & ROBINS-I) Visualizer Engine (robvis-style).
 * Produces publication-ready vector SVG Traffic Light Plots and Weighted Summary Bar Charts.
 * 
 * Standards:
 * - McGuinness & Higgins (2021). Risk-of-bias VISualization (robvis): An R package and Shiny web app.
 * - Cochrane Handbook for Systematic Reviews of Interventions (v6.4).
 */

import { ROB2_DOMAINS, ROBINS_DOMAINS } from "./risk-of-bias.js";

const ROB_COLORS = {
  low: { fill: "#2a9d8f", stroke: "#1f7a6f", text: "#ffffff", label: "Low Risk", symbol: "+" },
  some_concerns: { fill: "#e9c46a", stroke: "#c69f3d", text: "#264653", label: "Some Concerns", symbol: "?" },
  moderate: { fill: "#e9c46a", stroke: "#c69f3d", text: "#264653", label: "Moderate Risk", symbol: "?" },
  high: { fill: "#e76f51", stroke: "#b8472e", text: "#ffffff", label: "High Risk", symbol: "−" },
  critical: { fill: "#9b2226", stroke: "#6b1417", text: "#ffffff", label: "Critical Risk", symbol: "✕" },
  unclear: { fill: "#adb5bd", stroke: "#6c757d", text: "#ffffff", label: "Unclear / No info", symbol: "?" },
};

function normalizeRisk(level) {
  const norm = String(level || "").toLowerCase().trim();
  if (norm.includes("low")) return "low";
  if (norm.includes("crit")) return "critical";
  if (norm.includes("high")) return "high";
  if (norm.includes("mod")) return "moderate";
  if (norm.includes("some") || norm.includes("concern")) return "some_concerns";
  return "unclear";
}

/**
 * Generate Cochrane Traffic Light Plot SVG
 * @param {Object} options
 * @param {Array<Object>} options.assessments Array of study assessments
 * @param {"rob2"|"robins_i"} [options.tool="rob2"]
 * @param {string} [options.title]
 * @returns {string} SVG markup string
 */
export function generateTrafficLightPlotSVG(options = {}) {
  const {
    assessments = [],
    tool = "rob2",
    title = tool === "robins_i" ? "ROBINS-I Risk of Bias Assessment" : "Cochrane RoB 2.0 Risk of Bias Assessment",
  } = options;

  const domainDefs = tool === "robins_i" ? ROBINS_DOMAINS : ROB2_DOMAINS;
  const numDomains = domainDefs.length;

  const leftMargin = 260;
  const colWidth = 54;
  const rowHeight = 36;
  const headerHeight = 70;
  const legendHeight = 110 + numDomains * 18;
  const totalWidth = leftMargin + (numDomains + 1) * colWidth + 40;
  const studiesCount = Math.max(1, assessments.length);
  const totalHeight = headerHeight + studiesCount * rowHeight + legendHeight + 40;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="${totalHeight}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">\n`;
  svg += `  <style>\n`;
  svg += `    .rob-title { font-size: 16px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `    .rob-subtitle { font-size: 12px; fill: #64748b; }\n`;
  svg += `    .rob-header { font-size: 12px; font-weight: 700; fill: #334155; text-anchor: middle; }\n`;
  svg += `    .rob-study { font-size: 12px; font-weight: 600; fill: #1e293b; text-anchor: start; dominant-baseline: middle; }\n`;
  svg += `    .rob-symbol { font-size: 14px; font-weight: 800; text-anchor: middle; dominant-baseline: central; }\n`;
  svg += `    .rob-legend-title { font-size: 13px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `    .rob-legend-item { font-size: 11px; fill: #475569; }\n`;
  svg += `    .rob-grid { stroke: #f1f5f9; stroke-width: 1; }\n`;
  svg += `  </style>\n`;

  // Background card
  svg += `  <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff" rx="8"/>\n`;

  // Title
  svg += `  <text x="24" y="30" class="rob-title">${title}</text>\n`;
  svg += `  <text x="24" y="48" class="rob-subtitle">Traffic Light Plot (robvis standard) • Tool: ${tool.toUpperCase()}</text>\n`;

  // Header columns
  const headerY = headerHeight - 12;
  domainDefs.forEach((d, idx) => {
    const cx = leftMargin + idx * colWidth + colWidth / 2;
    svg += `  <text x="${cx}" y="${headerY}" class="rob-header">${d.id}</text>\n`;
  });
  const overallColX = leftMargin + numDomains * colWidth + colWidth / 2;
  svg += `  <text x="${overallColX}" y="${headerY}" class="rob-header" fill="#0f172a">Overall</text>\n`;

  // Separator
  svg += `  <line x1="20" y1="${headerHeight}" x2="${totalWidth - 20}" y2="${headerHeight}" stroke="#cbd5e1" stroke-width="1.5"/>\n`;

  // Studies rows
  assessments.forEach((studyItem, sIdx) => {
    const rowY = headerHeight + sIdx * rowHeight;
    const cy = rowY + rowHeight / 2;
    const isEven = sIdx % 2 === 0;

    if (isEven) {
      svg += `  <rect x="20" y="${rowY}" width="${totalWidth - 40}" height="${rowHeight}" fill="#f8fafc" rx="4"/>\n`;
    }

    const studyName = studyItem.study || studyItem.name || `Study ${sIdx + 1}`;
    const truncatedName = studyName.length > 32 ? studyName.substring(0, 30) + "…" : studyName;
    svg += `  <text x="28" y="${cy}" class="rob-study"><title>${studyName}</title>${truncatedName}</text>\n`;

    // Domains
    domainDefs.forEach((d, dIdx) => {
      const cx = leftMargin + dIdx * colWidth + colWidth / 2;
      const key = d.id.toLowerCase();
      const rawVal = studyItem[key] || studyItem[d.id] || "unclear";
      const norm = normalizeRisk(rawVal);
      const conf = ROB_COLORS[norm] || ROB_COLORS.unclear;

      svg += `  <g>\n`;
      svg += `    <circle cx="${cx}" cy="${cy}" r="12" fill="${conf.fill}" stroke="${conf.stroke}" stroke-width="1.2">\n`;
      svg += `      <title>${d.id} (${d.name}): ${conf.label}</title>\n`;
      svg += `    </circle>\n`;
      svg += `    <text x="${cx}" y="${cy}" fill="${conf.text}" class="rob-symbol">${conf.symbol}</text>\n`;
      svg += `  </g>\n`;
    });

    // Overall
    const rawOverall = studyItem.overall || "low";
    const normOverall = normalizeRisk(rawOverall);
    const confOverall = ROB_COLORS[normOverall] || ROB_COLORS.low;
    svg += `  <g>\n`;
    svg += `    <circle cx="${overallColX}" cy="${cy}" r="13" fill="${confOverall.fill}" stroke="${confOverall.stroke}" stroke-width="2">\n`;
    svg += `      <title>Overall Bias: ${confOverall.label}</title>\n`;
    svg += `    </circle>\n`;
    svg += `    <text x="${overallColX}" y="${cy}" fill="${confOverall.text}" class="rob-symbol">${confOverall.symbol}</text>\n`;
    svg += `  </g>\n`;
  });

  // Legend Area
  const legTop = headerHeight + studiesCount * rowHeight + 20;
  svg += `  <line x1="20" y1="${legTop}" x2="${totalWidth - 20}" y2="${legTop}" stroke="#e2e8f0" stroke-width="1"/>\n`;

  // Risk Level Badges
  const badgeY = legTop + 24;
  const badges = [
    { key: "low", label: "Low risk (+)" },
    { key: "some_concerns", label: "Some concerns (?)" },
    { key: "high", label: "High risk (−)" },
  ];
  if (tool === "robins_i") {
    badges.push({ key: "critical", label: "Critical risk (✕)" });
  }

  let badgeX = 28;
  badges.forEach((b) => {
    const conf = ROB_COLORS[b.key];
    svg += `  <circle cx="${badgeX + 6}" cy="${badgeY}" r="7" fill="${conf.fill}" stroke="${conf.stroke}" stroke-width="1"/>\n`;
    svg += `  <text x="${badgeX + 18}" y="${badgeY + 4}" class="rob-legend-item" font-weight="600">${b.label}</text>\n`;
    badgeX += 140;
  });

  // Domain definitions
  let defY = badgeY + 28;
  svg += `  <text x="28" y="${defY}" class="rob-legend-title">Domains:</text>\n`;
  defY += 16;
  domainDefs.forEach((d) => {
    svg += `  <text x="28" y="${defY}" class="rob-legend-item"><tspan font-weight="700">${d.id}:</tspan> ${d.name} (${d.desc})</text>\n`;
    defY += 16;
  });

  svg += `</svg>`;
  return svg;
}

/**
 * Generate Cochrane Weighted Summary Bar Chart SVG (robvis standard).
 * Displays stacked percentages of Low, Some Concerns, High, Critical across domains.
 * 
 * @param {Object} options
 * @param {Array<Object>} options.assessments
 * @param {"rob2"|"robins_i"} [options.tool="rob2"]
 * @param {string} [options.title]
 * @returns {string} SVG markup string
 */
export function generateSummaryBarSVG(options = {}) {
  const {
    assessments = [],
    tool = "rob2",
    title = tool === "robins_i" ? "ROBINS-I Risk of Bias Summary" : "RoB 2.0 Risk of Bias Summary (% of Studies)",
  } = options;

  const domainDefs = tool === "robins_i" ? ROBINS_DOMAINS : ROB2_DOMAINS;
  const allRows = [...domainDefs, { id: "Overall", name: "Overall Risk of Bias", desc: "Aggregated overall risk" }];

  const totalStudies = Math.max(1, assessments.length);

  // Compute percentages for each domain
  const summaryData = allRows.map((d) => {
    let low = 0;
    let some = 0;
    let high = 0;
    let critical = 0;
    let unclear = 0;

    assessments.forEach((item) => {
      let raw = "";
      if (d.id === "Overall") {
        raw = item.overall || "low";
      } else {
        const key = d.id.toLowerCase();
        raw = item[key] || item[d.id] || "unclear";
      }
      const norm = normalizeRisk(raw);
      if (norm === "low") low++;
      else if (norm === "some_concerns" || norm === "moderate") some++;
      else if (norm === "high") high++;
      else if (norm === "critical") critical++;
      else unclear++;
    });

    return {
      id: d.id,
      name: d.name,
      lowPct: (low / totalStudies) * 100,
      somePct: (some / totalStudies) * 100,
      highPct: (high / totalStudies) * 100,
      critPct: (critical / totalStudies) * 100,
      unclearPct: (unclear / totalStudies) * 100,
      lowCount: low,
      someCount: some,
      highCount: high,
      critCount: critical,
    };
  });

  const totalWidth = 780;
  const labelWidth = 230;
  const barWidth = 460;
  const barHeight = 24;
  const rowGap = 16;
  const headerHeight = 70;
  const totalHeight = headerHeight + allRows.length * (barHeight + rowGap) + 80;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="${totalHeight}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">\n`;
  svg += `  <style>\n`;
  svg += `    .bar-title { font-size: 16px; font-weight: 700; fill: #1e293b; }\n`;
  svg += `    .bar-sub { font-size: 12px; fill: #64748b; }\n`;
  svg += `    .bar-label { font-size: 12px; font-weight: 600; fill: #334155; text-anchor: end; dominant-baseline: middle; }\n`;
  svg += `    .bar-pct { font-size: 10px; font-weight: 700; fill: #ffffff; text-anchor: middle; dominant-baseline: middle; }\n`;
  svg += `    .axis-tick { font-size: 11px; fill: #64748b; text-anchor: middle; }\n`;
  svg += `  </style>\n`;

  // Background
  svg += `  <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff" rx="8"/>\n`;
  svg += `  <text x="24" y="30" class="bar-title">${title}</text>\n`;
  svg += `  <text x="24" y="48" class="bar-sub">Weighted summary of ${totalStudies} studies • Cochrane robvis standard</text>\n`;

  // Legend at Top Right
  const legX = totalWidth - 360;
  const legY = 32;
  const legendItems = [
    { key: "low", label: "Low" },
    { key: "some_concerns", label: "Some concerns" },
    { key: "high", label: "High" },
  ];
  if (tool === "robins_i") legendItems.push({ key: "critical", label: "Critical" });

  let curLegX = legX;
  legendItems.forEach((li) => {
    const c = ROB_COLORS[li.key];
    svg += `  <rect x="${curLegX}" y="${legY - 8}" width="12" height="12" rx="2" fill="${c.fill}"/>\n`;
    svg += `  <text x="${curLegX + 16}" y="${legY + 2}" font-size="11px" font-weight="600" fill="#334155">${li.label}</text>\n`;
    curLegX += li.label.length * 6.5 + 30;
  });

  // Bars
  summaryData.forEach((row, idx) => {
    const y = headerHeight + idx * (barHeight + rowGap);
    const labelY = y + barHeight / 2;
    const displayName = row.id === "Overall" ? "Overall Bias" : `${row.id}: ${row.name}`;
    const truncatedLabel = displayName.length > 34 ? displayName.substring(0, 32) + "…" : displayName;

    svg += `  <text x="${labelWidth - 14}" y="${labelY}" class="bar-label" ${row.id === "Overall" ? 'font-weight="700" fill="#0f172a"' : ""}><title>${displayName}</title>${truncatedLabel}</text>\n`;

    // Background track
    svg += `  <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#f1f5f9"/>\n`;

    // Segments: Low, Some Concerns, High, Critical
    let curX = labelWidth;
    const segments = [
      { key: "low", pct: row.lowPct, count: row.lowCount },
      { key: "some_concerns", pct: row.somePct, count: row.someCount },
      { key: "high", pct: row.highPct, count: row.highCount },
      { key: "critical", pct: row.critPct, count: row.critCount },
    ];

    segments.forEach((seg) => {
      if (seg.pct <= 0) return;
      const segW = (seg.pct / 100) * barWidth;
      const conf = ROB_COLORS[seg.key];
      svg += `  <rect x="${curX}" y="${y}" width="${segW}" height="${barHeight}" fill="${conf.fill}">\n`;
      svg += `    <title>${conf.label}: ${seg.pct.toFixed(1)}% (${seg.count}/${totalStudies})</title>\n`;
      svg += `  </rect>\n`;

      if (seg.pct >= 8) {
        const textX = curX + segW / 2;
        const textColor = seg.key === "some_concerns" ? "#264653" : "#ffffff";
        svg += `  <text x="${textX}" y="${labelY}" class="bar-pct" fill="${textColor}">${Math.round(seg.pct)}%</text>\n`;
      }
      curX += segW;
    });

    // Outer border around bar
    svg += `  <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="none" stroke="#cbd5e1" stroke-width="1"/>\n`;
  });

  // Bottom Axis (0%, 25%, 50%, 75%, 100%)
  const axisY = headerHeight + allRows.length * (barHeight + rowGap) + 6;
  svg += `  <line x1="${labelWidth}" y1="${axisY}" x2="${labelWidth + barWidth}" y2="${axisY}" stroke="#94a3b8" stroke-width="1"/>\n`;

  [0, 25, 50, 75, 100].forEach((tick) => {
    const tickX = labelWidth + (tick / 100) * barWidth;
    svg += `  <line x1="${tickX}" y1="${axisY}" x2="${tickX}" y2="${axisY + 4}" stroke="#94a3b8" stroke-width="1"/>\n`;
    svg += `  <text x="${tickX}" y="${axisY + 16}" class="axis-tick">${tick}%</text>\n`;
  });

  svg += `</svg>`;
  return svg;
}

/**
 * Complete Robvis evaluation suite
 */
export function generateRobvisReport(options = {}) {
  const { assessments = [], tool = "rob2", title } = options;
  const trafficLightSVG = generateTrafficLightPlotSVG({ assessments, tool, title });
  const summaryBarSVG = generateSummaryBarSVG({ assessments, tool, title });

  return {
    tool,
    totalStudies: assessments.length,
    trafficLightSVG,
    summaryBarSVG,
  };
}
