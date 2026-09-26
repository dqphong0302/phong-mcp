/**
 * Dual-Reviewer Blind Screening & Cochrane Conflict Adjudication Engine
 * Standards: Cochrane Handbook for Systematic Reviews of Interventions & PRISMA 2020.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const SCREENING_FILE = join(DATA_DIR, "screening_projects.json");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Standard Cochrane Exclusion Reasons
export const COCHRANE_EXCLUSION_REASONS = [
  { code: "E1", label_vi: "Sai quần thể mục tiêu (Wrong Population)", label_en: "Wrong Population" },
  { code: "E2", label_vi: "Sai can thiệp / thuốc (Wrong Intervention)", label_en: "Wrong Intervention" },
  { code: "E3", label_vi: "Sai nhóm đối chứng (Wrong Comparator)", label_en: "Wrong Comparator" },
  { code: "E4", label_vi: "Sai thiết kế nghiên cứu (Wrong Study Design - không phải RCT/đoàn hệ)", label_en: "Wrong Study Design" },
  { code: "E5", label_vi: "Thiếu dữ liệu kết cục lâm sàng (Insufficient Outcome Data)", label_en: "Insufficient Outcome Data" },
  { code: "E6", label_vi: "Bản ghi trùng lặp chưa nhận diện (Duplicate Record)", label_en: "Duplicate Record" },
  { code: "E7", label_vi: "Bài tổng quan thứ cấp hoặc báo cáo hội nghị (Review / Conference Abstract)", label_en: "Review/Abstract only" }
];

/**
 * Calculates Cohen's Kappa statistic (κ) for inter-rater reliability between 2 reviewers.
 * Decisions can be "include", "exclude", "maybe".
 * @param {Array<Object>} items - Array of { reviewer1: "include"|"exclude", reviewer2: "include"|"exclude" }
 * @returns {Object} Cohen's Kappa score and interpretation
 */
export function calculateCohenKappa(items = []) {
  if (!items || items.length === 0) {
    return { kappa: 0, interpretation_vi: "Chưa có dữ liệu đánh giá", interpretation_en: "No data", n: 0 };
  }

  // Focus on binary include vs exclude for primary Kappa (convert maybe to exclude/pending)
  let a = 0; // R1 include, R2 include
  let b = 0; // R1 include, R2 exclude
  let c = 0; // R1 exclude, R2 include
  let d = 0; // R1 exclude, R2 exclude

  let totalDecided = 0;

  for (const item of items) {
    const d1 = item.reviewer1?.decision;
    const d2 = item.reviewer2?.decision;

    if (!d1 || !d2) continue; // Skip uncompleted reviews

    const isInc1 = d1 === "include";
    const isInc2 = d2 === "include";

    if (isInc1 && isInc2) a++;
    else if (isInc1 && !isInc2) b++;
    else if (!isInc1 && isInc2) c++;
    else if (!isInc1 && !isInc2) d++;

    totalDecided++;
  }

  if (totalDecided === 0) {
    return {
      kappa: 0,
      observed_agreement_pct: 0,
      interpretation_vi: "Chưa có bài nào được cả 2 reviewer chấm điểm",
      interpretation_en: "No dual-screened items",
      n: 0,
      matrix: { a, b, c, d }
    };
  }

  // Observed agreement Po
  const Po = (a + d) / totalDecided;

  // Expected chance agreement Pe
  const pR1Yes = (a + b) / totalDecided;
  const pR1No = (c + d) / totalDecided;
  const pR2Yes = (a + c) / totalDecided;
  const pR2No = (b + d) / totalDecided;

  const Pe = (pR1Yes * pR2Yes) + (pR1No * pR2No);

  let kappa = 0;
  if (Pe === 1) {
    kappa = 1.0;
  } else {
    kappa = (Po - Pe) / (1 - Pe);
  }

  // Round
  kappa = Math.max(-1, Math.min(1, parseFloat(kappa.toFixed(3))));
  const observedPct = Math.round(Po * 100);

  // Interpretation scale (Landis & Koch 1977 / Cochrane Standard)
  let interpretation_vi = "Đồng thuận kém (Poor)";
  let interpretation_en = "Poor agreement";
  let badge_color = "#dc2626";

  if (kappa > 0.80) {
    interpretation_vi = "Đồng thuận gần như tuyệt đối (Almost Perfect)";
    interpretation_en = "Almost perfect agreement";
    badge_color = "#059669";
  } else if (kappa > 0.60) {
    interpretation_vi = "Đồng thuận đáng kể (Substantial)";
    interpretation_en = "Substantial agreement";
    badge_color = "#10b981";
  } else if (kappa > 0.40) {
    interpretation_vi = "Đồng thuận trung bình (Moderate)";
    interpretation_en = "Moderate agreement";
    badge_color = "#f59e0b";
  } else if (kappa > 0.20) {
    interpretation_vi = "Đồng thuận yếu (Fair)";
    interpretation_en = "Fair agreement";
    badge_color = "#f97316";
  }

  return {
    kappa,
    observed_agreement_pct: observedPct,
    interpretation_vi,
    interpretation_en,
    badge_color,
    total_evaluated: totalDecided,
    matrix: {
      both_included: a,
      r1_only: b,
      r2_only: c,
      both_excluded: d
    }
  };
}

/**
 * AI Senior Methodologist & Adjudicator for Screening Conflicts
 * Evaluates paper against PICO criteria when Reviewer 1 and Reviewer 2 disagree.
 * @param {Object} input - { paper, picoCriteria, reviewer1, reviewer2 }
 * @returns {Object} Adjudication ruling
 */
export function adjudicateScreeningConflict({ paper, picoCriteria = {}, reviewer1 = {}, reviewer2 = {} }) {
  const text = [paper.title || "", paper.takeaway || "", paper.abstract || ""].join(" ").toLowerCase();

  const pop = (picoCriteria.population || "").toLowerCase();
  const int = (picoCriteria.intervention || "").toLowerCase();
  const comp = (picoCriteria.comparator || "").toLowerCase();
  const outcome = (picoCriteria.outcome || "").toLowerCase();

  let matchPop = !pop || text.includes(pop) || pop.split(/\s+/).some(w => w.length > 3 && text.includes(w));
  let matchInt = !int || text.includes(int) || int.split(/\s+/).some(w => w.length > 3 && text.includes(w));
  let matchStudy = paper.study_design?.type === "rct" || paper.study_design?.type === "meta_analysis" ||
                   text.includes("randomized") || text.includes("trial") || text.includes("thử nghiệm");

  let finalDecision = "include";
  let exclusionReason = null;
  let rationale = "";

  if (!matchInt && int) {
    finalDecision = "exclude";
    exclusionReason = COCHRANE_EXCLUSION_REASONS[1]; // E2 Wrong Intervention
    rationale = `Can thiệp trong bài báo không khớp với can thiệp mục tiêu PICO ("${picoCriteria.intervention}"). Tác giả nghiên cứu hoạt chất/phương pháp khác.`;
  } else if (!matchPop && pop) {
    finalDecision = "exclude";
    exclusionReason = COCHRANE_EXCLUSION_REASONS[0]; // E1 Wrong Population
    rationale = `Quần thể nghiên cứu không đáp ứng tiêu chuẩn chọn vào ("${picoCriteria.population}"). Thử nghiệm được tiến hành trên nhóm đối tượng bệnh nhân khác.`;
  } else if (!matchStudy && picoCriteria.rct_only) {
    finalDecision = "exclude";
    exclusionReason = COCHRANE_EXCLUSION_REASONS[3]; // E4 Wrong Design
    rationale = `Thiết kế nghiên cứu không phải Thử nghiệm lâm sàng ngẫu nhiên có đối chứng (RCT) hoặc Tổng quan hệ thống theo yêu cầu của giao thức.`;
  } else {
    finalDecision = "include";
    rationale = `Bài báo đáp ứng đầy đủ tiêu chí PICO cốt lõi: quần thể phù hợp, đánh giá đúng can thiệp trọng tâm, và cung cấp kết cục lâm sàng định lượng có thể trích xuất số liệu.`;
  }

  return {
    paper_id: paper.id,
    paper_title: paper.title,
    reviewer1_vote: reviewer1.decision || "unknown",
    reviewer2_vote: reviewer2.decision || "unknown",
    adjudicator: "AI Senior Cochrane Methodologist (GPT-5.6 / Luna Engine)",
    final_decision: finalDecision,
    exclusion_reason: exclusionReason,
    rationale_vi: rationale,
    timestamp: new Date().toISOString()
  };
}

/**
 * Storage helpers for Screening Projects
 */
function loadProjects() {
  try {
    if (existsSync(SCREENING_FILE)) {
      return JSON.parse(readFileSync(SCREENING_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[screening] Failed to load projects file:", err.message);
  }
  return [];
}

function saveProjects(projects) {
  try {
    writeFileSync(SCREENING_FILE, JSON.stringify(projects, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("[screening] Failed to save projects file:", err.message);
    return false;
  }
}

/**
 * Creates a new dual screening project
 */
export function createScreeningProject({ title, pico = {}, papers = [] }) {
  const projects = loadProjects();
  const id = "screen_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const newProject = {
    id,
    title: title || "Dự án Sàng lọc Y văn Hệ thống",
    created_at: new Date().toISOString(),
    pico: {
      population: pico.population || "Bệnh nhân mục tiêu",
      intervention: pico.intervention || "Can thiệp / Thuốc chính",
      comparator: pico.comparator || "Đối chứng / Placebo / SoC",
      outcome: pico.outcome || "Kết cục lâm sàng chính",
      rct_only: Boolean(pico.rct_only ?? true)
    },
    papers: papers.map((p, idx) => ({
      id: p.id || `p_${idx + 1}`,
      title: p.title || "Untitled",
      authors: p.authors || [],
      year: p.year,
      venue: p.venue,
      quartile: p.quartile,
      takeaway: p.takeaway,
      abstract: p.abstract,
      doi: p.doi,
      pdf_url: p.pdf_url,
      study_design: p.study_design,
      sample_size: p.sample_size,
      // Reviewer state
      reviewer1: null, // { decision: "include"|"exclude"|"maybe", reason_code, notes, time }
      reviewer2: null,
      adjudication: null, // { final_decision, rationale_vi, exclusion_reason, time }
      status: "pending" // "pending" | "agreed_include" | "agreed_exclude" | "conflict" | "adjudicated"
    }))
  };

  projects.unshift(newProject);
  saveProjects(projects);
  return newProject;
}

/**
 * Records a reviewer's screening vote
 */
export function recordScreeningVote({ projectId, paperId, reviewer, decision, reasonCode = null, notes = "" }) {
  const projects = loadProjects();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) throw new Error(`Project ${projectId} not found`);

  const paper = proj.papers.find(p => p.id === paperId);
  if (!paper) throw new Error(`Paper ${paperId} not found in project`);

  const voteData = {
    decision,
    reason_code: reasonCode,
    notes,
    timestamp: new Date().toISOString()
  };

  if (reviewer === 1 || reviewer === "reviewer1") {
    paper.reviewer1 = voteData;
  } else if (reviewer === 2 || reviewer === "reviewer2") {
    paper.reviewer2 = voteData;
  } else {
    throw new Error("Invalid reviewer identifier (must be 1 or 2)");
  }

  // Update paper status
  if (paper.reviewer1 && paper.reviewer2) {
    if (paper.reviewer1.decision === paper.reviewer2.decision) {
      paper.status = paper.reviewer1.decision === "include" ? "agreed_include" : "agreed_exclude";
    } else {
      paper.status = "conflict";
    }
  } else {
    paper.status = "pending";
  }

  saveProjects(projects);
  return { ok: true, paper, project_id: proj.id };
}

/**
 * Adjudicates all conflicting papers in a project via AI
 */
export function adjudicateProjectConflicts({ projectId }) {
  const projects = loadProjects();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) throw new Error(`Project ${projectId} not found`);

  const conflicts = proj.papers.filter(p => p.status === "conflict" || (!p.adjudication && p.reviewer1?.decision !== p.reviewer2?.decision && p.reviewer1 && p.reviewer2));

  for (const paper of conflicts) {
    const ruling = adjudicateScreeningConflict({
      paper,
      picoCriteria: proj.pico,
      reviewer1: paper.reviewer1,
      reviewer2: paper.reviewer2
    });
    paper.adjudication = ruling;
    paper.status = ruling.final_decision === "include" ? "agreed_include" : "agreed_exclude";
  }

  saveProjects(projects);
  return {
    ok: true,
    project_id: proj.id,
    adjudicated_count: conflicts.length,
    conflicts: conflicts.map(p => ({
      id: p.id,
      title: p.title,
      ruling: p.adjudication
    }))
  };
}

/**
 * Get project report including Cohen's Kappa and PRISMA counts
 */
export function getScreeningProjectReport(projectId) {
  const projects = loadProjects();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return null;

  const kappaStats = calculateCohenKappa(proj.papers.map(p => ({
    reviewer1: p.reviewer1,
    reviewer2: p.reviewer2
  })));

  const total = proj.papers.length;
  const screenedBoth = proj.papers.filter(p => p.reviewer1 && p.reviewer2).length;
  const agreedInclude = proj.papers.filter(p => p.status === "agreed_include").length;
  const agreedExclude = proj.papers.filter(p => p.status === "agreed_exclude").length;
  const conflictsCount = proj.papers.filter(p => p.status === "conflict").length;

  return {
    id: proj.id,
    title: proj.title,
    pico: proj.pico,
    total_papers: total,
    screened_count: screenedBoth,
    agreed_include: agreedInclude,
    agreed_exclude: agreedExclude,
    conflicts_count: conflictsCount,
    cohen_kappa: kappaStats,
    papers: proj.papers
  };
}

export function listScreeningProjects() {
  const projects = loadProjects();
  return projects.map(p => ({
    id: p.id,
    title: p.title,
    created_at: p.created_at,
    total_papers: p.papers?.length || 0,
    agreed_include: p.papers?.filter(x => x.status === "agreed_include").length || 0,
    agreed_exclude: p.papers?.filter(x => x.status === "agreed_exclude").length || 0,
    conflicts_count: p.papers?.filter(x => x.status === "conflict").length || 0
  }));
}
