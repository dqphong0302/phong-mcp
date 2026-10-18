import type { Raw } from "../src/academic/types.ts";
// Hybrid stance classification: deterministic rules, with a model consulted
// only for papers the rules cannot settle.
//
//   node test/stance-hybrid.test.ts
//
// The escalation half needs a router key. Without one it is skipped rather
// than failed, so the suite still runs in CI and on a laptop with no secrets.

const B = new URL('../src/', import.meta.url).href;
const { academic } = await import(B + 'config.ts');
const { classifyStances } = await import(B + 'academic/stance-llm.ts');

// Cases deliberately at the edge of what text parsing can reach: no structured
// headings, no reported estimates, non-English, or indirect phrasing.
const Q = 'Does metformin reduce all-cause mortality in patients with type 2 diabetes?';
const SET: Array<[string, { title: string; abstract: string }, string]> = [
  ['structured + HR',      { title: 'A', abstract: 'CONCLUSIONS: Metformin reduced all-cause mortality (HR 0.80; 95% CI 0.72 to 0.90).' }, 'yes'],
  ['structured null',      { title: 'B', abstract: 'CONCLUSIONS: Metformin did not reduce all-cause mortality in this cohort.' }, 'no'],
  ['unstructured VI',      { title: 'C', abstract: 'Qua theo dõi 320 người bệnh đái tháo đường típ 2 dùng metformin trong 5 năm, nhóm nghiên cứu ghi nhận tỷ lệ tử vong chung ở nhóm dùng thuốc thấp hơn rõ rệt so với nhóm chứng.' }, 'yes'],
  ['unstructured VI null', { title: 'D', abstract: 'Nghiên cứu trên 210 bệnh nhân đái tháo đường típ 2 cho thấy tỷ lệ tử vong chung giữa nhóm dùng metformin và nhóm chứng là tương đương nhau.' }, 'no'],
  ['indirect phrasing',    { title: 'E', abstract: 'Patients with type 2 diabetes maintained on metformin outlived their counterparts on sulfonylureas over the ten-year follow-up period.' }, 'yes'],
  ['double negative',      { title: 'F', abstract: 'It would be incorrect to claim that metformin fails to confer a survival advantage in type 2 diabetes; the mortality data point the other way.' }, 'yes'],
  ['narrative no finding', { title: 'G', abstract: 'Metformin remains a cornerstone of therapy. Its place in practice continues to be debated among clinicians managing older adults with diabetes.' }, 'unclear'],
  ['harm direction',       { title: 'H', abstract: 'Among patients with type 2 diabetes, metformin exposure tracked with a steeper rise in all-cause mortality across every stratum examined.' }, 'no'],
];

const papers = SET.map(([, p]) => p);

async function run(label: Raw, cfg: Raw) {
  const t = Date.now();
  const { verdicts, escalated, escalationsApplied } = await classifyStances(papers, Q, cfg);
  const seconds = ((Date.now() - t) / 1000).toFixed(1);
  let ok = 0;
  console.log(`\n### ${label}`);
  SET.forEach(([name, , expected], i) => {
    const v = verdicts[i];
    const good = v.stance === expected;
    ok += Number(good);
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} exp=${expected.padEnd(8)} got=${v.stance.padEnd(8)} [${v.source}]`);
  });
  console.log(`  → ${ok}/${SET.length} correct · escalated ${escalationsApplied}/${escalated} · ${seconds}s`);
  return ok;
}

// Rules alone must stay correct on what they do answer: every verdict they
// return should be right, even though they abstain on much of this set.
const rulesOk = await run('RULES ONLY (escalation off)', academic);
const { verdicts: ruleVerdicts } = await classifyStances(papers, Q, academic);
const ruleWrong = SET.filter(([, , exp], i) =>
  ruleVerdicts[i].stance !== 'unclear' && ruleVerdicts[i].stance !== exp
);
console.log(`\nrules answered ${SET.length - ruleVerdicts.filter((v: Raw) => v.stance === 'unclear').length}` +
            `/${SET.length}, of which ${ruleWrong.length} wrong (must be 0)`);

let failed = ruleWrong.length > 0;

if (!academic.stanceLlm.apiKey) {
  console.log('\nSKIP hybrid: no router key in the environment (set NINE_ROUTER_API_KEY).');
} else {
  const hybridOk = await run('HYBRID (rules + escalation)', {
    ...academic,
    stanceLlm: { ...academic.stanceLlm, enabled: true },
  });
  console.log(`\nrules ${rulesOk}/${SET.length}  →  hybrid ${hybridOk}/${SET.length}`);
  if (hybridOk < rulesOk) {
    console.log('FAIL: escalation made the result worse');
    failed = true;
  }
}

// A dead router must leave the rule verdicts untouched rather than throw.
const { verdicts: fallback, escalationsApplied } = await classifyStances(papers, Q, {
  ...academic,
  stanceLlm: { ...academic.stanceLlm, enabled: true, baseUrl: 'https://router.invalid.example/v1', timeoutMs: 4000 },
});
const fellBack = escalationsApplied === 0 && fallback.every((v: Raw) => v.source === 'rules');
console.log(`\n${fellBack ? 'PASS' : 'FAIL'}  unreachable router falls back to rule verdicts`);
if (!fellBack) failed = true;

if (failed) process.exitCode = 1;
