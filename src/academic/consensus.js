/**
 * Academic Consensus Engine — evidence-weighted consensus quantification.
 *
 * Evaluates each paper's stance (Yes / No / Inconclusive) on a research
 * question and weights it by EBM study design, SCImago quartile (Q1-Q4) and
 * sample size.
 *
 * Stance itself comes from ./stance.js, which reads the paper's conclusion and
 * its effect estimates. The cue-word tables that used to live here scored the
 * entire abstract, so Background prose about other people's results counted
 * toward this paper's stance.
 */

import { classifyStance } from "./stance.js";
import { reportsResults } from "./publication-type.js";

// Study design evidence weights (EBM Pyramid)
const STUDY_DESIGN_WEIGHTS = {
  meta_analysis: 1.5,
  systematic_review: 1.5,
  rct: 1.35,
  clinical_trial: 1.25,
  cohort: 1.0,
  case_control: 0.85,
  cross_sectional: 0.75,
  observational: 0.7,
  guideline: 1.3,
  case_report: 0.45,
  in_vitro: 0.4,
  animal: 0.4,
  default: 0.7
};

// SCImago Quartile weights
const QUARTILE_WEIGHTS = {
  Q1: 1.4,
  Q2: 1.1,
  Q3: 0.8,
  Q4: 0.6,
  unranked: 0.5
};




/**
 * Detects whether a query is evaluative or directional (asking about effect, efficacy, risk, or comparison)
 * @param {string} query
 * @returns {boolean}
 */
/** Question words that only signal a yes/no question at the start of a query. */
const QUESTION_STARTERS = [
  "does", "do", "did", "is", "are", "was", "were", "can", "could",
  "should", "will", "would", "has", "have",
  "liệu", "có nên", "có phải",
];

/**
 * Effect/comparison markers. Matched as whole words — substring matching is
 * what made "sepsis" trigger on "is" and fired the consensus meter on plain
 * topic searches.
 */
const EVALUATIVE_MARKERS = [
  "effect", "effects", "efficacy", "effective", "effectiveness",
  "reduce", "reduces", "reduced", "increase", "increases", "increased",
  "benefit", "benefits", "harm", "harms", "risk", "risks",
  "versus", "vs", "compare", "compared", "comparison", "superior", "inferior",
  "improve", "improves", "improved", "prevent", "prevents", "prevention",
  "cause", "causes", "impact", "safety", "associated",
  "hiệu quả", "tác dụng", "ảnh hưởng", "so sánh", "nguy cơ", "lợi ích",
  "an toàn", "cải thiện", "phòng ngừa", "tác hại",
];

/** Whole-word / whole-phrase test that also works for Vietnamese. */
function containsTerm(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "iu").test(haystack);
}

/**
 * Detects whether a query actually asks an evaluative / directional question
 * (effect, efficacy, risk, comparison) rather than naming a research topic.
 *
 * A topic search such as "machine learning for early sepsis prediction in ICU"
 * has no yes/no answer, so quantifying "consensus" over its results is
 * meaningless — and misleading, because unrelated papers get counted as
 * "inconclusive" evidence.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function isEvaluativeQuery(query) {
  if (!query) return false;
  const q = String(query).toLowerCase().trim();

  if (QUESTION_STARTERS.some((w) => q.startsWith(`${w} `))) return true;
  return EVALUATIVE_MARKERS.some((m) => containsTerm(q, m));
}

/**
 * Infer the EBM study design from a paper's own text.
 *
 * Nothing upstream populates `study_design`, so before this existed every
 * paper fell through to the `default` weight and the report always said
 * "0 RCT/Meta-analysis" — even when the top hits were Lancet meta-analyses.
 *
 * @param {Object} paper
 * @returns {{ type: string, matched: string }|null}
 */
export function detectStudyDesign(paper) {
  const text = `${paper?.title || ""} ${paper?.abstract || ""} ${paper?.takeaway || ""} ${paper?.type || ""}`;
  if (!text.trim()) return null;

  // Ordered most-specific first: a network meta-analysis is a meta-analysis,
  // and an RCT write-up usually also contains the word "cohort".
  const RULES = [
    ["meta_analysis",     /\bmeta[-\s]?analys[ie]s\b|\bphân tích gộp\b/i],
    ["systematic_review", /\bsystematic (?:literature )?review\b|\bscoping review\b|\btổng quan hệ thống\b/i],
    ["guideline",         /\b(?:clinical )?practice guideline[s]?\b|\b(?:international|national|society) guideline[s]?\b|\bguideline[s]? for (?:the )?(?:management|diagnosis|treatment|prevention)\b|\bconsensus statement\b|\brecommendations? of the\b|\bhướng dẫn điều trị\b/i],
    ["rct",               /\brandomi[sz]ed[-\s](?:controlled[-\s])?trial\b|\brandomly assigned\b|\bdouble[-\s]blind\b|\bplacebo[-\s]controlled\b|\bthử nghiệm ngẫu nhiên\b/i],
    ["clinical_trial",    /\bclinical trial\b|\bphase (?:i{1,3}|1|2|3|4)\b|\bthử nghiệm lâm sàng\b/i],
    ["case_report",       /\bcase report\b|\bbáo cáo ca bệnh\b/i],
    ["animal",            /\bin vivo\b|\bmurine\b|\bmouse model\b|\brat model\b|\btrên chuột\b/i],
    ["in_vitro",          /\bin vitro\b|\bcell line[s]?\b/i],
    ["cohort",            /\bcohort stud(?:y|ies)\b|\bprospective stud(?:y|ies)\b|\bretrospective stud(?:y|ies)\b|\bnghiên cứu thuần tập\b/i],
    ["case_control",      /\bcase[-\s]control\b|\bbệnh[-\s]chứng\b/i],
    ["cross_sectional",   /\bcross[-\s]sectional\b|\bsurvey of\b|\bcắt ngang\b/i],
    ["observational",     /\bobservational\b|\breal[-\s]world (?:evidence|data)\b|\bregistry stud(?:y|ies)\b/i],
  ];

  for (const [type, re] of RULES) {
    const m = text.match(re);
    if (m) return { type, matched: m[0] };
  }
  return null;
}

/**
 * Analyzes the stance of an individual paper regarding the research query.
 * @param {Object} paper - Paper object with abstract, takeaway, title, study_design
 * @param {string} query - The search query
 * @returns {{ stance: "yes" | "no" | "inconclusive", confidence: number, reasoning: string }}
 */
export function analyzePaperStance(paper, query = "") {
  const verdict = classifyStance(paper, query);

  // The consensus meter has three buckets; the engine's "mixed" and "unclear"
  // both mean "this paper does not settle the question".
  const stance = verdict.stance === "yes" || verdict.stance === "no"
    ? verdict.stance
    : "inconclusive";

  return {
    stance,
    confidence: verdict.confidence,
    reasoning: verdict.basis,
    evidence: verdict.evidence,
    source_section: verdict.origin,
  };
}

/**
 * Computes evidence weight for a single paper
 * W = W_design * W_quartile * W_sample
 * @param {Object} paper
 * @returns {number}
 */
export function computePaperEvidenceWeight(paper) {
  const designType = paper.study_design?.type?.toLowerCase() || "default";
  const wDesign = STUDY_DESIGN_WEIGHTS[designType] || STUDY_DESIGN_WEIGHTS.default;

  const quartile = (paper.quartile || "").toUpperCase();
  const wQuartile = QUARTILE_WEIGHTS[quartile] || QUARTILE_WEIGHTS.unranked;

  let wSample = 0.9;
  if (paper.sample_size) {
    const numMatch = paper.sample_size.match(/\d[\d,.]*/);
    if (numMatch) {
      const n = parseInt(numMatch[0].replace(/[^\d]/g, ""), 10);
      if (n >= 10000) wSample = 1.35;
      else if (n >= 2000) wSample = 1.25;
      else if (n >= 500) wSample = 1.15;
      else if (n >= 100) wSample = 1.0;
      else if (n < 50) wSample = 0.75;
    }
  }

  return parseFloat((wDesign * wQuartile * wSample).toFixed(3));
}

/**
 * Quantifies academic consensus across a collection of papers.
 * @param {Array<Object>} papers - Array of enriched paper objects
 * @param {string} query - The research query/question
 * @returns {Object} Full consensus quantification report
 */
export function calculateAcademicConsensus(papers = [], query = "") {
  if (!Array.isArray(papers) || papers.length === 0) {
    return {
      has_consensus: false,
      total_analyzed: 0,
      verdict: "NO_DATA",
      verdict_label_vi: "Chưa có dữ liệu bài báo",
      verdict_label_en: "No paper data available",
      yes_pct: 0,
      no_pct: 0,
      inconclusive_pct: 0,
      summary_vi: "Chưa có đủ bài báo khoa học để lượng hóa mức độ đồng thuận.",
      supporting_count: 0,
      refuting_count: 0,
      inconclusive_count: 0
    };
  }

  // Records that report no findings — protocols, registry entries, editorials,
  // corrections — cannot support or refute anything. Counting them as
  // "inconclusive" evidence diluted every verdict toward "insufficient".
  const evidencePapers = papers.filter((p) => reportsResults(p).reports);
  const excludedNoResults = papers.length - evidencePapers.length;

  if (evidencePapers.length === 0) {
    return {
      has_consensus: false,
      total_analyzed: 0,
      verdict: "NO_DATA",
      verdict_label_vi: "Chưa có dữ liệu bài báo",
      verdict_label_en: "No result-reporting paper available",
      yes_pct: 0,
      no_pct: 0,
      inconclusive_pct: 0,
      summary_vi: `Không có bài báo nào báo cáo kết quả (đã loại ${excludedNoResults} đề cương/đăng ký/xã luận).`,
      supporting_count: 0,
      refuting_count: 0,
      inconclusive_count: 0,
      excluded_no_results: excludedNoResults,
    };
  }

  let totalWeight = 0;
  let weightYes = 0;
  let weightNo = 0;
  let weightInc = 0;

  const analyzedPapers = evidencePapers.map(paper => {
    // Nothing upstream fills this in, so infer it here — the evidence weight
    // and the "N RCT/meta-analysis" line both depend on it.
    if (!paper.study_design) {
      const design = detectStudyDesign(paper);
      if (design) paper.study_design = design;
    }

    const stanceResult = analyzePaperStance(paper, query);
    const weight = computePaperEvidenceWeight(paper);

    totalWeight += weight;
    if (stanceResult.stance === "yes") weightYes += weight;
    else if (stanceResult.stance === "no") weightNo += weight;
    else weightInc += weight;

    paper.stance = {
      type: stanceResult.stance,
      confidence: stanceResult.confidence,
      reasoning: stanceResult.reasoning,
      weight: weight
    };

    return paper;
  });

  if (totalWeight === 0) totalWeight = 1;

  let yes_pct = Math.round((weightYes / totalWeight) * 100);
  let no_pct = Math.round((weightNo / totalWeight) * 100);
  let inconclusive_pct = 100 - yes_pct - no_pct;

  if (inconclusive_pct < 0) {
    inconclusive_pct = 0;
    yes_pct = 100 - no_pct;
  }

  let verdict = "CONFLICTING";
  let verdict_label_vi = "Tranh cãi / Chưa thống nhất";
  let verdict_label_en = "Conflicting / Inconclusive";
  let verdict_color = "#f59e0b";

  if (yes_pct >= 75) {
    verdict = "STRONG_YES";
    verdict_label_vi = "Đồng thuận cao (Ủng hộ / Hiệu quả)";
    verdict_label_en = "Strong Consensus (Supporting)";
    verdict_color = "#059669";
  } else if (yes_pct >= 60) {
    verdict = "MODERATE_YES";
    verdict_label_vi = "Xu hướng ủng hộ (Moderate Support)";
    verdict_label_en = "Moderate Consensus (Supporting)";
    verdict_color = "#10b981";
  } else if (no_pct >= 75) {
    verdict = "STRONG_NO";
    verdict_label_vi = "Đồng thuận cao (Bác bỏ / Không hiệu quả)";
    verdict_label_en = "Strong Consensus (Refuting)";
    verdict_color = "#dc2626";
  } else if (no_pct >= 60) {
    verdict = "MODERATE_NO";
    verdict_label_vi = "Xu hướng bác bỏ (Moderate Refuting)";
    verdict_label_en = "Moderate Consensus (Refuting)";
    verdict_color = "#ef4444";
  } else if (inconclusive_pct >= 50) {
    verdict = "INCONCLUSIVE";
    verdict_label_vi = "Chưa đủ bằng chứng kết luận";
    verdict_label_en = "Insufficient Evidence";
    verdict_color = "#64748b";
  }

  const supporting_papers = analyzedPapers.filter(p => p.stance?.type === "yes");
  const refuting_papers = analyzedPapers.filter(p => p.stance?.type === "no");
  const inconclusive_papers = analyzedPapers.filter(p => p.stance?.type === "inconclusive");

  let summary_vi = "";
  if (verdict === "STRONG_YES" || verdict === "MODERATE_YES") {
    summary_vi = `Đa số các bằng chứng y văn quốc tế (${yes_pct}%) ủng hộ tính hiệu quả/tác động tích cực, đặc biệt từ các nghiên cứu chất lượng cao (Q1/RCT). Chỉ ${no_pct}% nghiên cứu ghi nhận kết quả không khác biệt.`;
  } else if (verdict === "STRONG_NO" || verdict === "MODERATE_NO") {
    summary_vi = `Y văn thể hiện xu hướng bác bỏ rõ rệt (${no_pct}%), cho thấy can thiệp không mang lại lợi ích có ý nghĩa thống kê hoặc tiềm ẩn nguy cơ. Chỉ có ${yes_pct}% nghiên cứu có kết quả tích cực đơn lẻ.`;
  } else if (verdict === "INCONCLUSIVE") {
    summary_vi = `Bằng chứng hiện tại chưa đủ mạnh để đưa ra kết luận dứt khoát (${inconclusive_pct}% chưa ngã ngũ). Cần thêm các thử nghiệm lâm sàng ngẫu nhiên có đối chứng (RCT) với cỡ mẫu lớn hơn.`;
  } else {
    summary_vi = `Chủ đề này đang có sự tranh cãi đáng kể trong cộng đồng học thuật (${yes_pct}% ủng hộ vs ${no_pct}% phản đối/không hiệu quả). Đây là khoảng trống nghiên cứu (Research Gap) rất giá trị để tiếp tục khám phá.`;
  }

  return {
    has_consensus: true,
    total_analyzed: analyzedPapers.length,
    verdict,
    verdict_label_vi,
    verdict_label_en,
    verdict_color,
    yes_pct,
    no_pct,
    inconclusive_pct,
    summary_vi,
    supporting_count: supporting_papers.length,
    refuting_count: refuting_papers.length,
    inconclusive_count: inconclusive_papers.length,
    q1_count: analyzedPapers.filter(p => p.quartile === "Q1").length,
    rct_count: analyzedPapers.filter(p => p.study_design?.type === "rct" || p.study_design?.type === "meta_analysis").length,
    excluded_no_results: excludedNoResults
  };
}
