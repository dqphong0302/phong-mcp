import type { Raw } from "../src/academic/types.ts";
// Stance-engine tests. Run: node test/stance.test.ts
// Every case below is either real published abstract text or a minimal
// reproduction of a misclassification observed against live search results.
const B = new URL('../src/academic/', import.meta.url).href;
const { classifyStance, parseEffectEstimates, parsePValue } = await import(B + 'stance.ts');
const old = await import(B + 'evidence-check.ts');

let pass = 0, fail = 0;
const t = (name: Raw, paper: Raw, question: Raw, expected: Raw) => {
  const r = classifyStance(paper, question);
  const oldR = old.classifyPaperStance ? old.classifyPaperStance(paper, question) : '—';
  const ok = r.stance === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      expected=${expected}  new=${r.stance} (${r.confidence})  old=${oldR}`);
  console.log(`      basis: ${r.basis}`);
  if (!ok) console.log(`      evidence: ${String(r.evidence).slice(0, 130)}`);
};

// 1. Real SELECT trial abstract (NEJM 2023) — clear significant benefit.
t('SELECT trial, significant HR', {
  abstract: 'BACKGROUND: Semaglutide, a glucagon-like peptide-1 receptor agonist, has been shown to reduce the risk of adverse cardiovascular events in patients with diabetes. METHODS: In a multicenter, double-blind, randomized, placebo-controlled trial we enrolled patients 45 years of age or older. RESULTS: A primary cardiovascular end-point event occurred in 569 of the 8803 patients (6.5%) in the semaglutide group and in 701 of the 8801 patients (8.0%) in the placebo group (hazard ratio, 0.80; 95% confidence interval, 0.72 to 0.90; P<0.001). CONCLUSIONS: In patients with preexisting cardiovascular disease and overweight or obesity but without diabetes, weekly subcutaneous semaglutide at a dose of 2.4 mg was superior to placebo in reducing the incidence of death from cardiovascular causes, nonfatal myocardial infarction, or nonfatal stroke.'
}, 'Does semaglutide reduce cardiovascular risk?', 'yes');

// 2. Real Look AHEAD abstract — explicit null result stated as "did not reduce".
t('Look AHEAD, null result', {
  abstract: 'BACKGROUND: Weight loss is recommended for overweight or obese patients with type 2 diabetes on the basis of short-term studies, and intensive lifestyle intervention significantly improves glycemic control and reduces cardiovascular risk factors. METHODS: In 16 study centers we randomly assigned patients. CONCLUSIONS: An intensive lifestyle intervention focusing on weight loss did not reduce the rate of cardiovascular events in overweight or obese adults with type 2 diabetes.'
}, 'Does intensive lifestyle intervention reduce cardiovascular events?', 'no');

// 3. THE KEY TRAP: Background praises the drug, Conclusions find nothing.
//    The old engine scored the Background text and answered "yes".
t('Background praise vs null conclusion', {
  abstract: 'BACKGROUND: GLP-1 receptor agonists significantly reduce major adverse cardiovascular events and demonstrate robust benefit and improved outcomes in large trials. METHODS: Retrospective cohort. CONCLUSIONS: In this cohort we observed no significant difference in mortality between treated and untreated patients.'
}, 'Does the drug reduce mortality?', 'no');

// 4. Effect in the OPPOSITE direction to the question.
t('opposite direction, significant', {
  abstract: 'CONCLUSIONS: Insulin monotherapy was associated with a higher incidence of vascular dementia (HR, 3.27; 95% CI, 3.03-3.52).'
}, 'Does insulin monotherapy reduce the risk of vascular dementia?', 'no');

// 5. Confidence interval crossing 1 — wording says "reduced", statistics do not.
t('CI crosses null despite "reduced"', {
  abstract: 'CONCLUSIONS: Treatment reduced the rate of hospitalisation (HR 0.95; 95% CI 0.85 to 1.06).'
}, 'Does treatment reduce hospitalisation?', 'no');

// 6. Hedged conclusion.
t('hedged conclusion', {
  abstract: 'CONCLUSIONS: Semaglutide may improve renal outcomes in this population. Larger prospective studies are needed to better define the role of GLP-1 RAs.'
}, 'Does semaglutide improve renal outcomes?', 'mixed');

// 7. p > 0.05 explicitly — a non-significant estimate is a null result, not 'mixed'.
t('p greater than 0.05', {
  abstract: 'CONCLUSIONS: Mean difference in memory score was 1.2 points (p = 0.21) favouring exercise.'
}, 'Does exercise improve memory?', 'no');

// 8. Desirable outcome, "effective" phrasing, significant increase.
t('desirable outcome via "effective"', {
  abstract: 'CONCLUSIONS: The intervention significantly improved treatment adherence (OR 2.10; 95% CI 1.44 to 3.06).'
}, 'Is the intervention effective for treatment adherence?', 'yes');

// 9. Vietnamese conclusion.
t('vietnamese null result', {
  abstract: 'Kết luận: Nghiên cứu không thấy sự khác biệt có ý nghĩa thống kê về tỷ lệ tuân thủ điều trị giữa hai nhóm.'
}, 'Can thiệp có cải thiện tuân thủ điều trị không?', 'no');

// 10. No usable text.
t('no abstract', { title: 'Some paper' }, 'Does X reduce Y?', 'unclear');

console.log('\n--- estimate parsing ---');
console.log(JSON.stringify(parseEffectEstimates('(hazard ratio, 0.80; 95% confidence interval, 0.72 to 0.90; P<0.001)')));
console.log(JSON.stringify(parseEffectEstimates('(HR 0.95; 95% CI 0.85 to 1.06)')));
console.log(JSON.stringify(parsePValue('P<0.001')), JSON.stringify(parsePValue('p = 0.21')));
console.log(`\n${pass} passed, ${fail} failed`);

// ── Regressions found on real PubMed text ────────────────────────────────────
console.log('\n--- real-text regressions ---');
let p2 = 0, f2 = 0;
const t2 = (name: Raw, paper: Raw, question: Raw, expected: Raw) => {
  const r = classifyStance(paper, question);
  const ok = r.stance === expected;
  ok ? p2++ : f2++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: expected=${expected} got=${r.stance}`);
  if (!ok) console.log(`      basis: ${r.basis}\n      evidence: ${String(r.evidence).slice(0,140)}`);
};

// "greater than 9 percent" is a threshold, not a result direction.
t2('threshold not direction', {
  abstract: 'CONCLUSIONS: Patients with type 2 diabetes mellitus and an initial A1C level greater than 9 percent should start insulin, and metformin should be continued if possible because it is proven to reduce all-cause mortality and cardiovascular events in overweight patients with diabetes.'
}, 'Does metformin reduce all-cause mortality in patients with type 2 diabetes?', 'yes');

// "enhanced mortality benefit" = less mortality, not more.
t2('increase in a good thing', {
  abstract: 'CONCLUSIONS: Older agents were associated with enhanced mortality benefit in patients with obstructive sleep apnea.'
}, 'Do GLP-1 agonists reduce mortality?', 'yes');

// A stated null finding phrased as "found that it was not".
t2('negative finding in reported speech', {
  abstract: 'CONCLUSIONS: This work investigated whether metformin use was associated with lower long-term incidence of dementia and all-cause mortality in obese patients and found that it was not.'
}, 'Does metformin reduce all-cause mortality?', 'no');

// The conclusion ends on tolerability; the answer is in the sentence before it.
t2('picks the sentence that answers the question', {
  title: 'Cardiovascular Effects and Tolerability of GLP-1 Receptor Agonists: A Meta-Analysis',
  abstract: 'CONCLUSIONS: GLP-1 receptor agonists significantly reduce major adverse cardiovascular events (HR 0.86; 95% CI 0.80 to 0.93). These come at increased gastrointestinal and gallbladder risks.'
}, 'Does semaglutide reduce major adverse cardiovascular events?', 'yes');

// "reducing ... MACE and improving ..." — the verb before the outcome governs it.
t2('verb preceding the outcome governs it', {
  abstract: 'CONCLUSIONS: These studies represent significant advances in reducing the risk of major adverse cardiovascular events (MACE) and improving metabolic outcomes in HFpEF, CKD, and OSA.'
}, 'Does semaglutide reduce major adverse cardiovascular events?', 'yes');

// Background epidemiology is not this paper's finding.
t2('context statement is not a finding', {
  abstract: 'CONCLUSIONS: Obesity during adolescence has also been associated with an increased risk of mortality from cardiovascular disease and type 2 diabetes in adulthood. Semaglutide reduced BMI in adolescents.'
}, 'Does semaglutide reduce major adverse cardiovascular events?', 'unclear');

// A different endpoint must not outrank the sentence that answers the question.
t2('ignores off-endpoint safety sentence', {
  abstract: 'CONCLUSIONS: There was no increase in risk of severe hypoglycaemia, pancreatitis, or pancreatic cancer. Treatment with GLP-1 receptor agonists has beneficial effects on cardiovascular, mortality, and kidney outcomes in patients with type 2 diabetes.'
}, 'Do GLP-1 receptor agonists reduce major adverse cardiovascular events?', 'yes');

console.log(`${p2} passed, ${f2} failed`);


// ── Publication type: does the record report findings at all? ────────────────
console.log('\n--- publication type ---');
const { reportsResults } = await import(B + 'publication-type.ts');
let p3 = 0, f3 = 0;
const t3 = (name: Raw, paper: Raw, expected: Raw) => {
  const r = reportsResults(paper);
  const ok = r.reports === expected;
  ok ? p3++ : f3++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: reports=${r.reports}${r.kind ? ` (${r.kind})` : ''}`);
};
t3('SELECT rationale and design', { title: 'Semaglutide Effects on Cardiovascular Outcomes (SELECT) rationale and design.' }, false);
t3('Cochrane protocol', { title: 'GLP-1 regimens compared with metformin', abstract: 'This is a protocol for a Cochrane review. The objectives are as follows: to assess benefits.' }, false);
t3('registry entry', { title: '[Clinical Trial NCT07325435] Beta Cell Function', source: 'clinicaltrials' }, false);
t3('letter to the editor', { title: 'Letter to the Editor: Endocrine determinants of DKA outcomes' }, false);
t3('author correction', { title: 'Author Correction: Metformin and mortality' }, false);
t3('future-tense methods', { title: 'A new trial', abstract: 'METHODS: 400 participants will be randomised. The primary outcome will be mortality.' }, false);
t3('completed RCT', { title: 'Semaglutide and Cardiovascular Outcomes', abstract: 'CONCLUSIONS: semaglutide was superior to placebo (HR 0.80).' }, true);
t3('meta-analysis', { title: 'Effects of GLP-1 RAs: a meta-analysis', abstract: 'CONCLUSIONS: GLP-1 RAs reduced MACE.' }, true);
console.log(`${p3} passed, ${f3} failed`);

if (fail + f2 + f3 > 0) process.exitCode = 1;
