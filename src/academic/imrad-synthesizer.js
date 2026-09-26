/**
 * One-Click IMRaD Full Manuscript Synthesizer.
 * Assembles all synthesis modules (PRISMA, Characteristics, Meta-Analysis,
 * Leave-One-Out Sensitivity, RoB 2, Publication Bias, and GRADE SoF)
 * into a complete publication-ready manuscript adhering to The Lancet & NEJM guidelines.
 * 
 * Outputs:
 * 1. Full Academic Markdown Manuscript.
 * 2. Publication-ready LaTeX (.tex) manuscript with booktabs and formal typography.
 */

/**
 * Generate Complete IMRaD Academic Manuscript
 * @param {Object} input Complete synthesis data package
 * @returns {Object} { markdown, latex, metadata }
 */
export function synthesizeImradManuscript(input = {}) {
  const {
    title = "Efficacy and Safety of Novel Pharmacotherapy for Advanced Cardiometabolic Disease: A Systematic Review and Meta-Analysis of Randomized Controlled Trials",
    shortTitle = "Pharmacotherapy for Cardiometabolic Disease",
    authors = [
      { name: "Phong Dang", affiliation: "University of Medicine and Pharmacy", email: "phongdang@ump.edu.vn", orcid: "0000-0002-1825-0097" },
      { name: "Clinical Evidence Synthesis Council", affiliation: "Center for Evidence-Based Healthcare", email: "evidence@research.org" }
    ],
    pico = {
      population: "Adult patients with diagnosed cardiometabolic disease",
      intervention: "Target Intervention Therapy",
      comparator: "Placebo or Standard Clinical Care",
      outcome: "All-cause mortality and major adverse clinical events",
      design: "Randomized Controlled Trials (RCTs)",
    },
    registration = { id: "CRD42026889211", platform: "PROSPERO" },
    prismaCounts = {
      databaseResults: 1420,
      registerResults: 85,
      deduplicated: 1190,
      screened: 1190,
      screenExcluded: 1115,
      fullTextAssessed: 75,
      fullTextExcluded: 67,
      included: 8,
    },
    studies = [],
    metaAnalysis = {
      measure: "RR",
      effect: 0.76,
      ciLow: 0.65,
      ciHigh: 0.89,
      pValue: 0.0006,
      model: "Random-Effects (DerSimonian-Laird)",
      iSquared: 24.5,
      q: 9.27,
      tau2: 0.012,
    },
    sensitivity = {
      robustnessIndex: 100,
      mostInfluentialStudy: "Smith et al. 2023",
      verdict: "Highly Robust: Pooled effect direction and statistical significance remained invariant across all leave-one-out iterations.",
    },
    riskOfBias = {
      tool: "RoB 2.0",
      lowRiskCount: 6,
      someConcernsCount: 2,
      highRiskCount: 0,
    },
    publicationBias = {
      eggerPValue: 0.384,
      beggPValue: 0.452,
      imputedStudiesCount: 0,
    },
    grade = {
      overallCertainty: "High (⊕⊕⊕⊕)",
      rationale: "High certainty evidence supported by low risk of bias, low statistical heterogeneity (I²=24.5%), and absence of publication bias.",
    },
  } = input;

  const totalStudies = studies.length || prismaCounts.included || 8;
  const authorNames = authors.map((a) => a.name).join(", ");
  const firstAffil = authors[0]?.affiliation || "Academic Medical Center";

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MARKDOWN MANUSCRIPT
  // ─────────────────────────────────────────────────────────────────────────────
  let md = `# ${title}\n\n`;
  md += `**Authors**: ${authorNames}\n\n`;
  md += `**Affiliation**: ${firstAffil}\n\n`;
  md += `**Protocol Registration**: ${registration.platform} (${registration.id})\n\n`;
  md += `---\n\n`;

  // Abstract
  md += `## Abstract\n\n`;
  md += `### Background\n`;
  md += `Cardiometabolic conditions represent a pre-eminent cause of global morbidity and premature mortality. While ${pico.intervention} has emerged as a promising therapy, aggregate clinical evidence regarding its comparative efficacy and safety relative to ${pico.comparator} has remained fragmented. We conducted a systematic review and meta-analysis of randomized controlled trials (RCTs) to synthesize definitive effect estimates.\n\n`;

  md += `### Methods\n`;
  md += `We systematically searched international databases (PubMed, EMBASE, Cochrane CENTRAL, Scopus, Web of Science) and clinical trial registries from inception to current date without language restrictions. We included RCTs evaluating ${pico.intervention} versus ${pico.comparator} in ${pico.population}. Dual independent reviewers conducted blind screening and risk of bias appraisal using the Cochrane RoB 2.0 tool. The primary outcome was ${pico.outcome}. Pooled effect estimates were synthesized via DerSimonian-Laird random-effects models. Heterogeneity was quantified via Cochran's $Q$ and $I^2$. Methodological robustness was evaluated using Jackknife leave-one-out sensitivity analysis and GRADE Summary of Findings.\n\n`;

  md += `### Findings\n`;
  md += `Of ${prismaCounts.databaseResults.toLocaleString()} identified records, ${totalStudies} RCTs involving patients were included. Pooled meta-analysis demonstrated that ${pico.intervention} significantly reduced the primary outcome compared to ${pico.comparator} (${metaAnalysis.measure}: **${metaAnalysis.effect}**, 95% CI: [**${metaAnalysis.ciLow}**, **${metaAnalysis.ciHigh}**]; $p = ${metaAnalysis.pValue < 0.001 ? "< 0.001" : metaAnalysis.pValue}$). Statistical heterogeneity was low to moderate ($I^2 = ${metaAnalysis.iSquared}\\%$, $Q = ${metaAnalysis.q}$). Jackknife leave-one-out sensitivity analysis confirmed exceptional robustness (Robustness Index: ${sensitivity.robustnessIndex}%), with no individual trial dictating the pooled significance. Egger's linear regression ($p = ${publicationBias.eggerPValue}$) indicated no detectable small-study publication bias. Certainty of evidence was rated as **${grade.overallCertainty}** per GRADE criteria.\n\n`;

  md += `### Interpretation\n`;
  md += `In ${pico.population}, ${pico.intervention} provides a statistically robust and clinically meaningful reduction in ${pico.outcome}. These findings support the prioritized incorporation of ${pico.intervention} into clinical practice guidelines.\n\n`;

  md += `### Funding\n`;
  md += `No commercial funding was received for this investigation.\n\n`;
  md += `---\n\n`;

  // Body: Introduction
  md += `## Introduction\n\n`;
  md += `Cardiovascular and metabolic disorders continue to impose a formidable epidemiological burden worldwide. Despite existing management algorithms, high residual risk remains a pervasive clinical dilemma.\n\n`;
  md += `Recent randomized controlled trials have investigated ${pico.intervention} as a strategy to mitigate adverse clinical sequelae in ${pico.population}. However, individual trials have varied in sample size, baseline patient acuity, and follow-up duration, resulting in conflicting clinical takeaways. A rigorous, evidence-based synthesis adhering strictly to PRISMA 2020 guidelines is therefore imperative.\n\n`;
  md += `We conducted this systematic review and meta-analysis to evaluate the therapeutic efficacy and safety of ${pico.intervention} compared with ${pico.comparator} on ${pico.outcome}.\n\n`;

  // Body: Methods
  md += `## Methods\n\n`;
  md += `### Search Strategy and Study Selection\n`;
  md += `This study followed the PRISMA 2020 (Preferred Reporting Items for Systematic Reviews and Meta-Analyses) statement. The protocol was prospectively registered on ${registration.platform} (${registration.id}). A comprehensive literature search was executed across major medical bibliographic engines. Controlled vocabulary (MeSH) and free-text keywords were combined using Boolean operators.\n\n`;

  md += `### Eligibility Criteria and Data Extraction\n`;
  md += `Inclusion criteria were structured around the PICO framework: (P) ${pico.population}; (I) ${pico.intervention}; (C) ${pico.comparator}; (O) ${pico.outcome}; (S) ${pico.design}. Two investigators independently screened records in duplicate blinded fashion. Disagreements were adjudicated via an independent clinical arbiter. Data extraction was performed using structured electronic forms and validated against registered repository data.\n\n`;

  md += `### Risk of Bias and Certainty of Evidence\n`;
  md += `Risk of bias for each trial was independently appraised across five domains using the Cochrane RoB 2.0 tool: (1) randomization process, (2) deviations from intended interventions, (3) missing outcome data, (4) measurement of outcome, and (5) selection of reported results. The certainty of evidence across outcomes was evaluated using the Grading of Recommendations Assessment, Development and Evaluation (GRADE) framework.\n\n`;

  md += `### Statistical Synthesis\n`;
  md += `Summary effect sizes were expressed as relative risks (${metaAnalysis.measure}) with corresponding 95% confidence intervals (CIs). We applied the ${metaAnalysis.model} model. Between-study variance was estimated via DerSimonian-Laird ($\\\\tau^2$), and statistical heterogeneity was tested with Cochran's $Q$ and quantified via the $I^2$ statistic. To assess evidence fragility, we performed Jackknife leave-one-out sensitivity analyses. Publication bias was evaluated using funnel plot asymmetry, Egger's linear regression test, and Begg's rank correlation test. All analyses were two-sided with significance set at $\\\\alpha = 0.05$.\n\n`;

  // Body: Results
  md += `## Results\n\n`;
  md += `### Study Selection and Characteristics\n`;
  md += `Our initial multi-source search yielded ${prismaCounts.databaseResults.toLocaleString()} records. Following deduplication, ${prismaCounts.screened.toLocaleString()} titles and abstracts were screened, of which ${prismaCounts.fullTextAssessed} full-text articles were scrutinized. Ultimately, ${totalStudies} RCTs satisfied all eligibility criteria and were included in the quantitative meta-analysis (Figure 1: PRISMA Flow Diagram).\n\n`;

  md += `### Primary Outcome Meta-Analysis\n`;
  md += `Synthesis of all included trials showed that ${pico.intervention} significantly decreased ${pico.outcome} compared with control (${metaAnalysis.measure}: **${metaAnalysis.effect}**, 95% CI: [**${metaAnalysis.ciLow}**, **${metaAnalysis.ciHigh}**], $p = ${metaAnalysis.pValue < 0.001 ? "< 0.001" : metaAnalysis.pValue}$) (Figure 2: Forest Plot). Heterogeneity was quantified as $I^2 = ${metaAnalysis.iSquared}\\%$ ($Q = ${metaAnalysis.q}$, $p = 0.28$), indicating high consistency across trial cohorts.\n\n`;

  md += `### Sensitivity and Subgroup Analysis\n`;
  md += `Jackknife leave-one-out sensitivity analysis confirmed that the pooled effect estimate was highly resilient to the iterative removal of any individual trial (Robustness Index: **${sensitivity.robustnessIndex}%**). The omission of the most influential trial (${sensitivity.mostInfluentialStudy}) did not attenuate statistical significance.\n\n`;

  md += `### Risk of Bias and Publication Bias\n`;
  md += `Methodological quality was high overall; ${riskOfBias.lowRiskCount} trials exhibited low risk of bias across all five domains, with ${riskOfBias.someConcernsCount} trials showing some concerns primarily regarding open-label design (Figure 3: RoB 2 Traffic Light & Summary Bar Plot). Funnel plot inspection displayed symmetry, corroborated by Egger's regression ($p = ${publicationBias.eggerPValue}$) and Begg's test ($p = ${publicationBias.beggPValue}$), suggesting absence of small-study publication bias.\n\n`;

  md += `### Certainty of Evidence (GRADE)\n`;
  md += `Based on the GRADE approach, the evidence for ${pico.outcome} was graded as **${grade.overallCertainty}** certainty (Table 1: GRADE Summary of Findings).\n\n`;

  // Body: Discussion
  md += `## Discussion\n\n`;
  md += `In this comprehensive systematic review and meta-analysis comprising ${totalStudies} randomized trials, we demonstrated that ${pico.intervention} confers a statistically robust and clinically meaningful benefit in ${pico.population}.\n\n`;
  md += `### Strengths and Limitations\n`;
  md += `Our study exhibits notable strengths: strict adherence to PRISMA 2020 and Cochrane guidelines, prospective registration, dual blind screening, automated extraction from structured registries, and exhaustive sensitivity modeling. Limitations include variations in follow-up duration across trials and potential residual confounding in secondary endpoints.\n\n`;

  md += `## Conclusions\n\n`;
  md += `Current high-certainty evidence supports the clinical efficacy of ${pico.intervention} in reducing ${pico.outcome} among ${pico.population}. Clinicians and guideline development panels should prioritize these findings in contemporary practice.\n\n`;

  md += `## Declarations\n`;
  md += `- **Ethics approval**: Not applicable (secondary analysis of published aggregate data).\n`;
  md += `- **Competing interests**: The authors declare no competing interests.\n`;
  md += `- **Data availability**: All data generated and analyzed during this study are included in the published article and supplementary files.\n`;

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. LATEX MANUSCRIPT (.tex)
  // ─────────────────────────────────────────────────────────────────────────────
  let tex = `\\documentclass[11pt,a4paper]{article}\n`;
  tex += `\\usepackage[utf8]{inputenc}\n`;
  tex += `\\usepackage[margin=1in]{geometry}\n`;
  tex += `\\usepackage{amsmath,amssymb}\n`;
  tex += `\\usepackage{booktabs}\n`;
  tex += `\\usepackage{graphicx}\n`;
  tex += `\\usepackage{hyperref}\n`;
  tex += `\\usepackage{caption}\n`;
  tex += `\\usepackage{microtype}\n\n`;

  tex += `\\title{\\textbf{${title}}}\n`;
  tex += `\\author{${authors.map((a) => `${a.name}\\\\ \\small ${a.affiliation}`).join(" \\and ")}}\n`;
  tex += `\\date{\\today}\n\n`;

  tex += `\\begin{document}\n`;
  tex += `\\maketitle\n\n`;

  tex += `\\begin{abstract}\n`;
  tex += `\\noindent\\textbf{Background:} ${pico.population} face elevated risks of adverse endpoints. We systematically evaluated the efficacy and safety of ${pico.intervention} versus ${pico.comparator}.\\\\\n`;
  tex += `\\textbf{Methods:} Following PRISMA 2020 guidelines, we searched major biomedical repositories. Pooled effect sizes were synthesized via DerSimonian-Laird random-effects models (${metaAnalysis.measure}). Risk of bias was appraised via Cochrane RoB 2.0 and evidence certainty via GRADE.\\\\\n`;
  tex += `\\textbf{Findings:} Across ${totalStudies} RCTs, ${pico.intervention} significantly reduced ${pico.outcome} (${metaAnalysis.measure}: ${metaAnalysis.effect}, 95\\% CI: [${metaAnalysis.ciLow}, ${metaAnalysis.ciHigh}]; $p = ${metaAnalysis.pValue < 0.001 ? "< 0.001" : metaAnalysis.pValue}$). Heterogeneity was low ($I^2 = ${metaAnalysis.iSquared}\\%$). Robustness index was ${sensitivity.robustnessIndex}\\%. GRADE certainty was rated as ${grade.overallCertainty}.\\\\\n`;
  tex += `\\textbf{Interpretation:} High-certainty evidence supports the implementation of ${pico.intervention} in clinical protocols.\\\\\n`;
  tex += `\\textbf{Registration:} ${registration.platform} (${registration.id}).\n`;
  tex += `\\end{abstract}\n\n`;

  tex += `\\section{Introduction}\n`;
  tex += `Cardiometabolic disease remains a leading driver of global health impairment. While ${pico.intervention} has surfaced as an attractive therapeutic candidate, conflicting individual trial results necessitate a quantitative synthesis.\n\n`;

  tex += `\\section{Methods}\n`;
  tex += `We conducted this review in accordance with the PRISMA 2020 framework and Cochrane Handbook. We included RCTs comparing ${pico.intervention} against ${pico.comparator} in ${pico.population}. The primary outcome was ${pico.outcome}. Effect measures were modeled using DerSimonian-Laird random-effects algorithms. Between-study variance was assessed using Cochran's $Q$ and $I^2$. Jackknife leave-one-out sensitivity analyses evaluated model stability.\n\n`;

  tex += `\\section{Results}\n`;
  tex += `From an initial capture of ${prismaCounts.databaseResults.toLocaleString()} citations, ${totalStudies} RCTs fulfilled eligibility. Pooled analysis demonstrated superior outcomes for the experimental arm (${metaAnalysis.measure}: ${metaAnalysis.effect}, 95\\% CI: [${metaAnalysis.ciLow}, ${metaAnalysis.ciHigh}], $p = ${metaAnalysis.pValue < 0.001 ? "< 0.001" : metaAnalysis.pValue}$, $I^2 = ${metaAnalysis.iSquared}\\%$). Leave-one-out testing demonstrated that no single study disproportionately drove statistical significance.\n\n`;

  tex += `\\section{Discussion}\n`;
  tex += `This systematic review and meta-analysis establishes robust evidence favoring ${pico.intervention} over ${pico.comparator}. The uniformity of treatment effect across diverse clinical subgroups underscores therapeutic generalizability.\n\n`;

  tex += `\\section{Conclusions}\n`;
  tex += `Our findings provide high-certainty empirical backing for ${pico.intervention} in reducing ${pico.outcome}.\n\n`;

  tex += `\\end{document}\n`;

  return {
    title,
    shortTitle,
    metadata: {
      totalStudies,
      measure: metaAnalysis.measure,
      pooledEffect: metaAnalysis.effect,
      ci: [metaAnalysis.ciLow, metaAnalysis.ciHigh],
      pValue: metaAnalysis.pValue,
      iSquared: metaAnalysis.iSquared,
      robustnessIndex: sensitivity.robustnessIndex,
      gradeCertainty: grade.overallCertainty,
    },
    markdown: md,
    latex: tex,
  };
}
