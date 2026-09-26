/**
 * GRADE Summary of Findings (SoF) Table Engine
 * Standard: GRADE Handbook (Schünemann et al., 2013) & Cochrane Handbook Chapter 14.
 */

export const GRADE_LEVELS = {
  HIGH: "High (Cao)",
  MODERATE: "Moderate (Trung bình)",
  LOW: "Low (Thấp)",
  VERY_LOW: "Very Low (Rất thấp)",
};

export function assessGradeOutcome(outcome) {
  let score = outcome.studyType === "observational" ? 2 : 4; // RCT starts at High (4), Observational at Low (2)
  const downgrades = [];

  // 1. Risk of Bias
  if (outcome.riskOfBias === "very_serious") {
    score -= 2;
    downgrades.push("Nguy cơ sai lệch rất nghiêm trọng (-2)");
  } else if (outcome.riskOfBias === "serious") {
    score -= 1;
    downgrades.push("Nguy cơ sai lệch nghiêm trọng (-1)");
  }

  // 2. Inconsistency (I^2)
  const i2 = outcome.i2 ?? (outcome.inconsistency === "very_serious" ? 75 : (outcome.inconsistency === "serious" ? 50 : 0));
  if (outcome.inconsistency === "very_serious" || i2 > 70) {
    score -= 2;
    downgrades.push(`Tính không nhất quán rất nghiêm trọng (I² = ${i2}%) (-2)`);
  } else if (outcome.inconsistency === "serious" || i2 > 40) {
    score -= 1;
    downgrades.push(`Tính không nhất quán nghiêm trọng (I² = ${i2}%) (-1)`);
  }

  // 3. Indirectness
  if (outcome.indirectness === "very_serious") {
    score -= 2;
    downgrades.push("Bằng chứng gián tiếp rất nghiêm trọng (-2)");
  } else if (outcome.indirectness === "serious") {
    score -= 1;
    downgrades.push("Bằng chứng gián tiếp nghiêm trọng (-1)");
  }

  // 4. Imprecision (Sample size & CI width)
  if (outcome.imprecision === "very_serious") {
    score -= 2;
    downgrades.push("Độ thiếu chính xác rất nghiêm trọng (-2)");
  } else if (outcome.imprecision === "serious") {
    score -= 1;
    downgrades.push("Độ thiếu chính xác nghiêm trọng (-1)");
  }

  // 5. Publication Bias
  if (outcome.publicationBias === "strongly_suspected") {
    score -= 1;
    downgrades.push("Nghi ngờ sai lệch xuất bản (-1)");
  }

  score = Math.max(1, Math.min(4, score));
  const certainty = score === 4 ? GRADE_LEVELS.HIGH : (score === 3 ? GRADE_LEVELS.MODERATE : (score === 2 ? GRADE_LEVELS.LOW : GRADE_LEVELS.VERY_LOW));

  return { score, certainty, downgrades };
}

export function generateGradeSoFTable(data = {}) {
  const {
    title = "GRADE Summary of Findings",
    population = "Target Clinical Population",
    intervention = "Intervention",
    comparator = "Comparator",
    setting = "Clinical Setting",
    outcomes = [],
  } = data;

  const assessedOutcomes = outcomes.map((o) => {
    const grade = assessGradeOutcome(o);
    const eff = o.pooledEffect || { measure: "OR", estimate: 1.0, ciLow: 0.8, ciHigh: 1.2 };
    return {
      ...o,
      grade,
      effectFormatted: `${eff.measure} ${eff.estimate} (95% CI ${eff.ciLow} - ${eff.ciHigh})`,
    };
  });

  // Markdown format
  let md = `## 📋 GRADE Summary of Findings Table: ${title}\n\n`;
  md += `**Population**: ${population} | **Setting**: ${setting}\n`;
  md += `**Intervention**: ${intervention} | **Comparator**: ${comparator}\n\n`;
  md += `| Biến số kết cục | Thiết kế & Cỡ mẫu | Hiệu quả tương đối (95% CI) | Mức độ chắc chắn (GRADE) | Ghi chú giảm bậc |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const o of assessedOutcomes) {
    const notes = o.grade.downgrades.length > 0 ? o.grade.downgrades.join(", ") : "Không có yếu tố giảm bậc";
    md += `| **${o.outcomeName}** | ${o.studyType?.toUpperCase()} (${o.studiesCount || 1} nghiên cứu, N=${o.totalPatients || "N/A"}) | ${o.effectFormatted} | **${o.grade.certainty}** | ${notes} |\n`;
  }

  // HTML format
  let html = `<div class="grade-sof-table"><h3>${title}</h3><p><strong>P:</strong> ${population} | <strong>I:</strong> ${intervention} | <strong>C:</strong> ${comparator}</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Biến số kết cục</th><th>Nghiên cứu & Cỡ mẫu</th><th>Hiệu quả (95% CI)</th><th>Chắc chắn (GRADE)</th></tr></thead><tbody>`;
  for (const o of assessedOutcomes) {
    html += `<tr><td><strong>${o.outcomeName}</strong></td><td>${o.studiesCount} thử nghiệm (N=${o.totalPatients})</td><td>${o.effectFormatted}</td><td>${o.grade.certainty}</td></tr>`;
  }
  html += `</tbody></table></div>`;

  // LaTeX Booktabs format
  let latex = `\\begin{table}[htbp]\n\\centering\n\\caption{${title}}\n\\begin{tabular}{lllll}\n\\toprule\nOutcome & Studies (N) & Effect (95\\% CI) & Certainty & Downgrades \\\\\n\\midrule\n`;
  for (const o of assessedOutcomes) {
    latex += `${o.outcomeName} & ${o.studiesCount} (${o.totalPatients}) & ${o.effectFormatted} & ${o.grade.certainty} & ${o.grade.downgrades.length} \\\\\n`;
  }
  latex += `\\bottomrule\n\\end{tabular}\n\\end{table}`;

  return {
    ok: true,
    title,
    population,
    intervention,
    comparator,
    setting,
    outcomes: assessedOutcomes,
    markdown: md,
    html,
    latex,
  };
}
