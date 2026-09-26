/**
 * PROSPERO Protocol Preregistration & Peer Review Rebuttal Response Matrix Generator
 */

export function generateProsperoProtocol(data = {}) {
  const {
    title = "Systematic Review Protocol",
    reviewQuestion = "PICO Research Question",
    searches = "PubMed, Embase, Cochrane CENTRAL, VJOL",
    conditionOrDomain = "Clinical condition",
    participants = "Target patient population",
    interventions = "Intervention under evaluation",
    comparators = "Comparator or Control group",
    outcomes = "Primary and secondary outcomes",
  } = data;

  let md = `## 📑 PROSPERO CRD Protocol Registration Draft\n\n`;
  md += `### 1. Review title\n${title}\n\n`;
  md += `### 2. Review question(s)\n${reviewQuestion}\n\n`;
  md += `### 3. Searches\n${searches}\n\n`;
  md += `### 4. Condition or domain being studied\n${conditionOrDomain}\n\n`;
  md += `### 5. Participants/population\n${participants}\n\n`;
  md += `### 6. Intervention(s), exposure(s)\n${interventions}\n\n`;
  md += `### 7. Comparator(s)/control\n${comparators}\n\n`;
  md += `### 8. Main outcome(s)\n${outcomes}\n\n`;

  return { ok: true, title, markdown: md };
}

export function generateRebuttalMatrix(data = {}) {
  const {
    manuscriptId = "MS-2026-001",
    journal = "Q1 Medical Journal",
    items = [],
  } = data;

  let md = `## 📬 Point-by-Point Response to Reviewers\n\n`;
  md += `**Manuscript ID**: ${manuscriptId} | **Journal**: ${journal}\n\n`;
  md += `| # | Reviewer Comment | Author Response | Manuscript Revision & Line # |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    md += `| **${i + 1}** | "${it.comment}" | **Response**: ${it.response} | *Revised at*: ${it.location || "Page X, Line Y"} |\n`;
  }

  return { ok: true, manuscriptId, journal, items, markdown: md };
}
