import { tokenizeQuery, relevanceScore } from "./sources/_relevance.js";

/**
 * Stance engine — decides what a paper actually concludes about a question.
 *
 * Replaces the bag-of-words scorer that preceded it. That approach counted
 * cue words anywhere in the abstract, so "significant", "reduce" and
 * "associated" scored just as highly when they appeared in a Background
 * sentence describing OTHER people's work, and "no significant difference"
 * contributed to the positive tally because it contains "significant".
 *
 * This engine instead:
 *   1. reads only the conclusion-bearing text (Conclusions section, TL;DR, or
 *      Results — never Background/Methods, where prior work is described);
 *   2. parses real effect estimates (HR/OR/RR/MD with 95% CI, p-values) and
 *      derives direction and statistical significance from them;
 *   3. resolves negation and hedging per clause rather than per abstract;
 *   4. compares the direction the paper reports against the direction the
 *      question asks about, so "X increases mortality" is not filed as support
 *      for "does X reduce mortality?";
 *   5. returns the sentence it relied on, so every verdict is auditable.
 *
 * Deterministic and dependency-free: no model call, same input → same output.
 */

// ── Abstract structure ────────────────────────────────────────────────────────

/** Structured-abstract headings, by the role they play. */
const SECTION_HEADINGS = {
  conclusion: /\b(?:conclusions?(?:\s+and\s+relevance)?|interpretation|summary|kết luận)\b\s*[:.—-]/i,
  results: /\b(?:results?|findings?|main outcome measures?|kết quả)\b\s*[:.—-]/i,
  background: /\b(?:background|introduction|context|objectives?|aims?|purpose|rationale|importance|methods?|design|setting|participants|patients|đặt vấn đề|mục tiêu|phương pháp)\b\s*[:.—-]/i,
};

/**
 * Pull out the part of an abstract where the authors state their own finding.
 *
 * @param {Object} paper
 * @returns {{ text: string, origin: string }}
 */
export function extractConclusionText(paper) {
  const tldr = typeof paper?.tldr === "string" ? paper.tldr : paper?.tldr?.text || "";
  const takeaway = paper?.takeaway || "";
  const abstract = stripMarkup(paper?.abstract || "");

  if (abstract) {
    const conc = sliceSection(abstract, "conclusion");
    if (conc) return { text: conc, origin: "conclusions" };
  }

  // A TL;DR is a one-line statement of the finding — when it is a finding at all.
  if (isSubstantive(tldr)) return { text: tldr.trim(), origin: "tldr" };

  if (abstract) {
    // Unstructured abstract: the finding lives at the end, not in the opening
    // sentences (which set up the problem). Preferred over the generated
    // `takeaway`, which is frequently a funding line, a trial-registration id
    // or a restatement of the objective rather than a result.
    const sentences = splitSentences(abstract).filter((x) => isSubstantive(x));
    if (sentences.length >= 3) {
      return { text: sentences.slice(-2).join(" "), origin: "abstract_tail" };
    }
    if (sentences.length) return { text: sentences.join(" "), origin: "abstract" };

    const res = sliceSection(abstract, "results");
    if (res) return { text: res, origin: "results" };
  }

  if (isSubstantive(takeaway)) return { text: takeaway.trim(), origin: "takeaway" };

  return { text: String(paper?.title || ""), origin: "title" };
}

/**
 * Effect estimates reported in the Results section.
 *
 * Authors routinely state the finding in words in the Conclusions and leave the
 * numbers in the Results ("...was superior to placebo in reducing the incidence
 * ..." / "hazard ratio, 0.80; 95% CI, 0.72 to 0.90"). Reading only one section
 * therefore throws away the statistic that settles the question.
 *
 * @param {Object} paper
 * @returns {Array}
 */
export function extractSupportingStats(paper) {
  const abstract = stripMarkup(paper?.abstract || "");
  if (!abstract) return [];
  const results = sliceSection(abstract, "results");
  const text = results || abstract;
  return splitSentences(text).flatMap((sentence) => parseEffectEstimates(sentence));
}

/**
 * Boilerplate that carries no finding: funding acknowledgements, registration
 * identifiers, protocol objectives, data-availability notes. These dominate the
 * generated `takeaway` field for many records, and reading one as the paper's
 * conclusion produces a confident verdict about nothing.
 */
const BOILERPLATE_RE =
  /^(?:\s*\(?(?:funded|funding|supported)\b|\s*(?:agency|national institute|european foundation|nihr|nih|wellcome)\b)|\b(?:PROSPERO|CRD4\d+|ClinicalTrials\.gov|ISRCTN\d+|NCT\d{6,})\b|\bthe objectives? (?:are|is) as follows\b|\bthis is a protocol for\b|\bdata (?:are|is) available\b|\bunrestricted educational grant\b/i;

/** Does this text plausibly state a finding? */
function isSubstantive(text) {
  const t = String(text || "").trim();
  if (t.length < 25) return false;
  if (BOILERPLATE_RE.test(t)) return false;
  // A line that is mostly an organisation name has no verb doing any work.
  return /\s/.test(t) && t.split(/\s+/).length >= 5;
}

/**
 * The abstract minus its Background/Methods sections.
 *
 * Used as a second sweep when the conclusion text says nothing about the
 * question — some abstracts close on tolerability, leaving the efficacy
 * conclusion further up. Background stays excluded so prior work still cannot
 * be mistaken for this paper's finding.
 *
 * @param {Object} paper
 * @returns {string}
 */
export function extractNonBackgroundText(paper) {
  const abstract = stripMarkup(paper?.abstract || "");
  if (!abstract) return "";

  const bg = abstract.match(SECTION_HEADINGS.background);
  if (!bg) return abstract;

  // Keep everything from the first Results/Conclusions heading onward.
  for (const kind of ["results", "conclusion"]) {
    const m = abstract.match(SECTION_HEADINGS[kind]);
    if (m) return abstract.slice(m.index);
  }
  return abstract;
}

/** Text from `heading` up to the next recognised heading. */
function sliceSection(abstract, kind) {
  const head = SECTION_HEADINGS[kind];
  const m = abstract.match(head);
  if (!m) return null;

  const start = m.index + m[0].length;
  const rest = abstract.slice(start);

  // Stop at whichever heading comes next.
  let end = rest.length;
  for (const re of Object.values(SECTION_HEADINGS)) {
    const n = rest.match(re);
    if (n && n.index < end) end = n.index;
  }
  const out = rest.slice(0, end).trim();
  return out.length >= 20 ? out : null;
}

/** Drop the JATS/HTML wrappers Europe PMC and Crossref leave in abstracts. */
function stripMarkup(s) {
  return String(s)
    // <h4>Conclusions</h4> carries the section name — keep it as "Conclusions:".
    .replace(/<\/?h[1-6][^>]*>/gi, (m) => (m.startsWith("</") ? ": " : " "))
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence split that does not break on "0.80 (95% CI, 0.72 to 0.90)." etc. */
export function splitSentences(text) {
  return String(text)
    .replace(/(\d)\.(\d)/g, "$1․$2")            // protect decimals
    .replace(/\b(?:vs|cf|e\.g|i\.e|approx|Fig|No)\./gi, (m) => m.replace(".", "․"))
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ỹ(])/)
    .map((s) => s.replace(/․/g, ".").trim())
    .filter((s) => s.length > 0);
}

// ── Effect estimates ──────────────────────────────────────────────────────────

/** Ratio measures are null at 1; difference measures are null at 0. */
const RATIO_MEASURES = new Set(["hr", "or", "rr", "irr", "shr", "ahr", "aor", "arr_ratio"]);

const MEASURE_RE =
  /\b(adjusted\s+)?(hazard ratio|odds ratio|risk ratio|rate ratio|incidence rate ratio|relative risk|mean difference|standardi[sz]ed mean difference|aHR|HR|aOR|OR|RR|IRR|SHR|MD|SMD)\b(?:[\s,:=]*(?:of\s+)?|[^.;()]{0,40}?\b(?:was|of|were|=|:)\s*)(-?\d+(?:\.\d+)?)/gi;

const CI_RE =
  /95\s*%?\s*(?:confidence interval|ci)[\s,:=]*\(?\s*(-?\d+(?:\.\d+)?)\s*(?:to|-|–|—|,)\s*(-?\d+(?:\.\d+)?)\s*\)?/i;

const P_RE = /\bp\s*(<|>|=|≤|≥|<=|>=)\s*(0?\.\d+|\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*[-−]\s*\d+)?)/i;

const MEASURE_ALIASES = {
  "hazard ratio": "hr", ahr: "hr", hr: "hr",
  "odds ratio": "or", aor: "or", or: "or",
  "risk ratio": "rr", "relative risk": "rr", rr: "rr",
  "rate ratio": "irr", "incidence rate ratio": "irr", irr: "irr",
  shr: "shr",
  "mean difference": "md", md: "md",
  "standardized mean difference": "smd", "standardised mean difference": "smd", smd: "smd",
};

/**
 * Parse effect estimates out of a sentence.
 *
 * @param {string} sentence
 * @returns {Array<{measure:string, value:number, ci:[number,number]|null, significant:boolean|null, direction:"down"|"up"|"none"|null, raw:string}>}
 */
export function parseEffectEstimates(sentence) {
  const out = [];
  const text = String(sentence);

  MEASURE_RE.lastIndex = 0;
  let m;
  while ((m = MEASURE_RE.exec(text)) !== null) {
    const measure = MEASURE_ALIASES[m[2].toLowerCase()] || m[2].toLowerCase();
    const value = parseFloat(m[3]);
    if (!Number.isFinite(value)) continue;

    // A CI that follows within the same clause belongs to this estimate.
    const tail = text.slice(m.index, m.index + 200);
    const ciMatch = tail.match(CI_RE);
    const ci = ciMatch
      ? [parseFloat(ciMatch[1]), parseFloat(ciMatch[2])].sort((a, b) => a - b)
      : null;

    const isRatio = RATIO_MEASURES.has(measure) || ["hr", "or", "rr", "irr", "shr"].includes(measure);
    const nullValue = isRatio ? 1 : 0;

    let significant = null;
    if (ci && Number.isFinite(ci[0]) && Number.isFinite(ci[1])) {
      significant = !(ci[0] <= nullValue && nullValue <= ci[1]);
    } else {
      const p = parsePValue(tail);
      if (p !== null) significant = p.significant;
    }

    let direction = null;
    if (value < nullValue) direction = "down";
    else if (value > nullValue) direction = "up";
    if (significant === false) direction = "none";

    out.push({ measure, value, ci, significant, direction, raw: m[0] });
  }

  return out;
}

/**
 * Parse a p-value and say whether it clears the 0.05 threshold.
 *
 * @param {string} text
 * @returns {{ value:number, operator:string, significant:boolean }|null}
 */
export function parsePValue(text) {
  const m = String(text).match(P_RE);
  if (!m) return null;
  const operator = m[1];
  const value = parseFloat(String(m[2]).replace(/\s*[x×]\s*10\s*[-−]\s*(\d+)/, "e-$1"));
  if (!Number.isFinite(value)) return null;

  const significant =
    (operator === "<" || operator === "≤" || operator === "<=") ? value <= 0.05 :
    (operator === "=") ? value < 0.05 :
    false; // p > 0.05 / p ≥ 0.05
  return { value, operator, significant };
}

// ── Clause-level reading ──────────────────────────────────────────────────────

const NEGATION_RE =
  /\b(?:no|not|never|neither|nor|without|failed to|fails to|did not|does not|do not|was not|were not|is not|are not|lacked|lacking|absence of|unable to|non-?significant|nonsignificant|insignificant|không|chưa|không có)\b/i;

const HEDGE_RE =
  /\b(?:may|might|could|possibly|potentially|appears? to|seems? to|suggests?|suggesting|warrant(?:s|ed)? (?:further|additional)|(?:further|more|larger|additional|future|prospective|randomi[sz]ed|well-designed)\s+(?:\w+\s+){0,2}?(?:studies|trials|research|work|data)\b|(?:studies|trials|research|data)\s+(?:are|is)\s+(?:needed|warranted|required)|remains? (?:unclear|uncertain|to be)|preliminary|hypothesis-generating|should be interpreted with caution|có thể|cần (?:thêm )?nghiên cứu|chưa rõ)\b/i;

/**
 * Refutations that arrive AFTER the claim they cancel: "...investigated whether
 * metformin was associated with lower mortality and found that it was not."
 * Backward-looking negation scope cannot see these, and without them the
 * sentence reads as a positive finding — the exact opposite of what it reports.
 * Deliberately narrow, so a second clause about a different endpoint ("reduced
 * mortality and was not associated with harm") is not mistaken for a refutation.
 */
const TRAILING_NEGATION_RE =
  /\b(?:found (?:that )?(?:it|this|they) (?:was|were) not|(?:but|however)[,\s]+(?:it|this|that) (?:was|were) not|(?:was|were) not (?:observed|confirmed|supported|replicated|the case|statistically significant)|no such (?:association|effect|benefit|difference)|did not (?:hold|persist|remain))\b/i;

const NULL_RESULT_RE =
  /\b(?:no (?:significant |statistically significant )?(?:difference|effect|association|benefit|improvement|reduction|increase|change)|did not (?:significantly )?(?:differ|reduce|improve|increase|decrease|affect)|was not associated with|were not associated with|failed to (?:show|demonstrate|reduce|improve)|not superior to|equivalent to|non-?inferior|no evidence of (?:benefit|effect|efficacy)|không (?:thấy |ghi nhận |có )?(?:sự )?khác biệt|không (?:làm )?(?:giảm|cải thiện)|chưa (?:thấy|ghi nhận) (?:sự )?(?:khác biệt|hiệu quả))\b/i;

const DOWN_VERBS =
  /\b(?:reduc(?:e|es|ed|tion|ing)|decreas(?:e|es|ed|ing)|lower(?:s|ed|ing)?|declin(?:e|es|ed|ing)|diminish(?:es|ed)?|attenuat(?:e|es|ed)|prevent(?:s|ed|ion)?|protect(?:s|ed|ive)?|less likely|fewer|giảm|hạ|phòng ngừa)\b/i;

/**
 * Verbs that state which way the OUTCOME moved. Kept strictly separate from the
 * comparative markers below: "superior to placebo in reducing events" moves the
 * outcome DOWN while praising the drug, and conflating the two made that
 * sentence read as an increase — the exact opposite of what it says.
 */
const UP_VERBS =
  /\b(?:increas(?:e|es|ed|ing)|improv(?:e|es|ed|ement|ing)|enhanc(?:e|es|ed)|rais(?:e|es|ed)|higher|greater|more likely|tăng|cải thiện)\b/i;

/**
 * Comparative markers: the intervention came out ahead, without saying which
 * way any particular number moved. Only consulted when no outcome verb is present.
 */
const SUPERIORITY_RE =
  /\b(?:superior to|better than|more effective|most effective|effective(?:ness)? (?:in|for|at)|efficacious|beneficial|benefit(?:s|ed)? (?:in|for|from)|favou?r(?:s|ed|ing) (?:the )?(?:intervention|treatment|group|exercise|\w+)|in favou?r of|vượt trội|có hiệu quả)\b/i;

/** Outcomes where "more" is bad, so a reduction is the favourable direction. */
const ADVERSE_OUTCOME_RE =
  /\b(?:mortality|death|deaths|died|fatal|morbidity|risk|events?|incidence|hospitali[sz]ation|readmission|relapse|recurrence|progression|failure|complication|adverse|infection|stroke|infarction|amputation|tử vong|biến chứng|nguy cơ|tái phát)\b/i;

/**
 * Nouns that are themselves desirable. An INCREASE in one of these is a
 * favourable result, not an adverse one: "enhanced mortality benefit" means
 * less mortality, and reading the "enhanced" as an outcome rising inverts the
 * paper's meaning.
 */
const FAVOURABLE_NOUN_RE =
  /\b(?:benefit|benefits|efficacy|effectiveness|protection|survival|remission|response|adherence|compliance|quality of life|function|recovery|lợi ích|sống sót|đáp ứng)\b/i;

/**
 * Phrasing that reports established context rather than this paper's finding:
 * "Obesity during adolescence has also been associated with an increased risk
 * of mortality." True, but it says nothing about whether the drug under study
 * works — and read as a result it flips the paper's verdict.
 */
const CONTEXTUAL_CLAIM_RE =
  /\b(?:ha[sv]e? (?:also )?(?:long )?been (?:associated|linked|shown|reported|recognis|recogniz)\w*|is (?:a )?(?:well[- ])?(?:known|established) (?:risk factor|cause)|are (?:a )?(?:well[- ])?(?:known|established) risk factors)\b/i;

/**
 * Contexts where a comparative word describes a threshold or a baseline rather
 * than a result: "greater than 9 percent", "aged over 65", "at least 3 months".
 */
const THRESHOLD_CONTEXT_RE = /\b(?:greater|higher|lower|less|more|fewer)\s+than\b|\b(?:at least|no more than|up to|aged|older than|younger than)\b/i;

/**
 * What direction does the question ask about, and is its outcome adverse?
 *
 * @param {string} question
 * @returns {{ asked:"down"|"up"|"benefit", adverseOutcome:boolean }}
 */
export function parseQuestion(question) {
  const q = String(question || "");
  const adverseOutcome = ADVERSE_OUTCOME_RE.test(q);

  // The verb the question itself uses wins; "effective/beneficial" phrasing has
  // no direction of its own and is resolved against the outcome instead.
  if (DOWN_VERBS.test(q)) return { asked: "down", adverseOutcome };
  if (UP_VERBS.test(q) && !/\beffective|efficac|benefit/i.test(q)) {
    return { asked: "up", adverseOutcome };
  }
  return { asked: "benefit", adverseOutcome };
}

/**
 * Read one sentence as a claim.
 *
 * @param {string} sentence
 * @param {string[]} [focusTerms] terms naming the question's outcome, used to
 *   pick which verb carries the claim when a sentence states several
 * @returns {{ direction:"down"|"up"|"none"|null, superiority:boolean, significant:boolean|null, hedged:boolean, estimates:Array, negated:boolean }}
 */
export function readSentence(sentence, focusTerms = []) {
  const s = String(sentence);
  const estimates = parseEffectEstimates(s);
  const hedged = HEDGE_RE.test(s);
  const isNull = NULL_RESULT_RE.test(s);
  const negated = NEGATION_RE.test(s); // informational only — scope is applied below

  // A quantitative estimate is the strongest evidence available and overrides
  // the wording — authors routinely write "reduced" next to a CI crossing 1.
  const decisive = estimates.find((e) => e.significant === true);
  if (decisive) {
    return { direction: decisive.direction, significant: true, hedged, estimates, negated };
  }
  if (estimates.length && estimates.every((e) => e.significant === false)) {
    return { direction: "none", significant: false, hedged, estimates, negated };
  }

  if (isNull) return { direction: "none", significant: false, hedged, estimates, negated };

  const p = parsePValue(s);
  const down = DOWN_VERBS.test(s);
  const up = hasMeaningfulUpVerb(s);

  let direction = null;
  let verbIndex = -1;
  if (down && !up) { direction = "down"; verbIndex = s.search(DOWN_VERBS); }
  else if (up && !down) { direction = "up"; verbIndex = s.search(UP_VERBS); }
  else if (down && up) {
    direction = firstVerbDirection(s, focusTerms);
    verbIndex = s.search(direction === "down" ? DOWN_VERBS : UP_VERBS);
  }

  // No outcome verb, but the authors say the intervention won. That answers the
  // question favourably whichever way the underlying number moved.
  const superiority = direction === null && SUPERIORITY_RE.test(s);
  if (superiority) verbIndex = s.search(SUPERIORITY_RE);

  // Negation only counts inside the clause that carries the verb. Applied to
  // the whole sentence it misreads population descriptors: "in patients ...
  // WITHOUT diabetes, semaglutide was superior in REDUCING events" is a
  // positive finding, not a null one.
  if (direction && negatedInClause(s, verbIndex)) direction = "none";

  // A refutation placed after the claim cancels it just as effectively.
  if (direction && verbIndex >= 0 && TRAILING_NEGATION_RE.test(s.slice(verbIndex))) {
    direction = "none";
  }

  if (superiority && negatedInClause(s, verbIndex)) {
    return { direction: "none", superiority: false, significant: false, hedged, estimates, negated };
  }

  const significant = p ? p.significant : ((direction && direction !== "none") || superiority ? null : false);
  return { direction, superiority, significant, hedged, estimates, negated };
}

/**
 * Is the direction verb at `verbIndex` negated by its own clause?
 *
 * Scope runs back to the nearest clause boundary, so a negation in an earlier
 * clause cannot reach across and flip this one.
 *
 * @param {string} sentence
 * @param {number} verbIndex
 * @returns {boolean}
 */
function negatedInClause(sentence, verbIndex) {
  if (verbIndex < 0) return NEGATION_RE.test(sentence);
  const before = sentence.slice(0, verbIndex);
  const boundary = Math.max(
    before.lastIndexOf(","), before.lastIndexOf(";"),
    before.lastIndexOf(":"), before.lastIndexOf("("),
    before.lastIndexOf(" but "), before.lastIndexOf(" whereas "), before.lastIndexOf(" while ")
  );
  return NEGATION_RE.test(before.slice(boundary + 1));
}

/**
 * Does the sentence raise an outcome, as opposed to merely containing a
 * comparative word used for a threshold or applied to a desirable noun?
 *
 * @param {string} s
 * @returns {boolean}
 */
function hasMeaningfulUpVerb(s) {
  let re = new RegExp(UP_VERBS.source, "gi");
  let m;
  while ((m = re.exec(s)) !== null) {
    const context = s.slice(Math.max(0, m.index - 25), m.index + 45);
    if (THRESHOLD_CONTEXT_RE.test(context)) continue;      // "greater than 9 percent"
    if (FAVOURABLE_NOUN_RE.test(s.slice(m.index, m.index + 45))) continue; // "enhanced ... benefit"
    return true;
  }
  return false;
}

/**
 * When a sentence contains both directions, prefer the verb sitting closest to
 * what the question is about. "Metformin ... is proven to REDUCE all-cause
 * MORTALITY ... and weight gain was more common with insulin" states a
 * reduction in the outcome asked about; picking the textually-first comparative
 * would report the opposite.
 *
 * @param {string} s
 * @param {string[]} [focusTerms] terms naming the question's outcome
 * @returns {"down"|"up"}
 */
function firstVerbDirection(s, focusTerms = []) {
  const d = s.search(DOWN_VERBS);
  const u = s.search(UP_VERBS);
  if (d === -1) return "up";
  if (u === -1) return "down";

  if (focusTerms.length) {
    const lower = s.toLowerCase();
    let best = { distance: Infinity, dir: null, preceding: false };
    for (const term of focusTerms) {
      const at = lower.indexOf(term.toLowerCase());
      if (at === -1) continue;
      for (const [idx, dir] of [[d, "down"], [u, "up"]]) {
        // English puts the verb before its object: in "reducing the risk of
        // MACE and improving metabolic outcomes" it is "reducing" that governs
        // MACE, even though "improving" sits closer to it. So a verb preceding
        // the outcome always beats one that follows it.
        const preceding = idx < at;
        const distance = Math.abs(idx - at);
        const better =
          preceding !== best.preceding ? preceding : distance < best.distance;
        if (better) best = { distance, dir, preceding };
      }
    }
    if (best.dir) return best.dir;
  }
  return d < u ? "down" : "up";
}

// ── Verdict ───────────────────────────────────────────────────────────────────

/**
 * Decide what a paper concludes about a question.
 *
 * @param {Object} paper
 * @param {string} question
 * @returns {{ stance:"yes"|"no"|"mixed"|"unclear", confidence:number, basis:string, evidence:string|null, origin:string }}
 */
export function classifyStance(paper, question) {
  const { text, origin } = extractConclusionText(paper);
  if (!text || text.trim().length < 12) {
    return { stance: "unclear", confidence: 0.2, basis: "no abstract or summary text available", evidence: null, origin };
  }

  const { asked, adverseOutcome } = parseQuestion(question);
  const sentences = splitSentences(text);
  const focusTerms = questionFocusTerms(question);
  const questionTerms = tokenizeQuery(question);

  const pick = (candidates) => {
    let chosen = null;
    for (const sentence of candidates) {
      const claim = readSentence(sentence, focusTerms);
      if (!claim.direction && !claim.superiority) continue;

      const favourable = claim.superiority ? true : isFavourable(claim.direction, asked, adverseOutcome);
      const score =
        (claim.estimates.some((e) => e.significant !== null) ? 3 : 0) +
        (claim.significant === true ? 2 : 0) +
        (claim.direction === "none" ? 2 : 0) +
        (claim.hedged ? 0 : 1);

      if (!chosen || score > chosen.score) chosen = { claim, sentence, favourable, score };
    }
    return chosen;
  };

  // The answer has to be a sentence about the question. Abstracts routinely
  // close on tolerability ("these come at increased gastrointestinal risks") or
  // on a different endpoint ("no increase in risk of pancreatitis"); scoring
  // those against an efficacy question inverts the paper's conclusion. So
  // sentences that mention the question are considered first, and the rest only
  // if none of them do.
  const onQuestion = (sentence) =>
    questionTerms.length === 0 || relevanceScore(sentence, questionTerms, question) > 0;
  const isFinding = (sentence) => !CONTEXTUAL_CLAIM_RE.test(sentence);

  let best = pick(sentences.filter((x) => onQuestion(x) && isFinding(x)));

  // Nothing in the conclusion addresses the question — look through the rest of
  // the abstract (Background excluded) before giving up.
  if (!best) {
    const wider = splitSentences(extractNonBackgroundText(paper)).filter(
      (x) => onQuestion(x) && isFinding(x)
    );
    best = pick(wider);
  }
  if (!best) best = pick(sentences.filter(isFinding));
  if (!best) best = pick(sentences);

  if (!best) {
    return {
      stance: "unclear",
      confidence: 0.3,
      basis: "no directional claim found in the conclusion",
      evidence: sentences[0] || null,
      origin,
    };
  }

  let { claim, sentence, favourable } = best;
  let quantified = claim.estimates.some((e) => e.significant !== null);
  let corroboration = null;

  // The conclusion asserts a direction but cites no number — look for the
  // matching estimate in Results before falling back to a low-confidence verdict.
  if (!quantified && claim.direction && claim.direction !== "none") {
    const agreeing = extractSupportingStats(paper).filter(
      (e) => e.significant === true && e.direction === claim.direction
    );
    if (agreeing.length) {
      corroboration = agreeing;
      quantified = true;
      claim = { ...claim, significant: true, estimates: agreeing };
    }
  }

  // Explicit null result — the authors found nothing.
  if (claim.direction === "none") {
    return {
      stance: "no",
      confidence: quantified ? 0.85 : 0.7,
      basis: quantified
        ? `null result, confidence interval spans no effect (${claim.estimates.map((e) => e.raw).join("; ")})`
        : "authors report no significant difference",
      evidence: sentence,
      origin,
    };
  }

  // Effect in the opposite direction to the one asked about.
  if (favourable === false) {
    return {
      stance: "no",
      confidence: claim.significant === true ? 0.85 : 0.6,
      basis: `effect reported in the opposite direction (${claim.direction})`,
      evidence: sentence,
      origin,
    };
  }

  // Effect in the direction asked about.
  if (claim.significant === true) {
    return {
      stance: "yes",
      confidence: quantified ? 0.9 : 0.75,
      basis: quantified
        ? `statistically significant effect (${claim.estimates.map((e) => e.raw).join("; ")})` +
          (corroboration ? " — estimate taken from Results, direction agrees with the conclusion" : "")
        : "authors report a statistically significant effect",
      evidence: sentence,
      origin,
    };
  }

  if (claim.hedged) {
    return {
      stance: "mixed",
      confidence: 0.55,
      basis: "effect stated with hedging or a call for further study",
      evidence: sentence,
      origin,
    };
  }

  if (claim.significant === false) {
    return {
      stance: "mixed",
      confidence: 0.6,
      basis: "directional claim not supported by a significant estimate",
      evidence: sentence,
      origin,
    };
  }

  return {
    stance: "yes",
    confidence: 0.62,
    basis: "authors state a directional finding without a reported estimate",
    evidence: sentence,
    origin,
  };
}

/**
 * The outcome words a question is about, used to decide which verb in a
 * multi-claim sentence carries the answer.
 *
 * @param {string} question
 * @returns {string[]}
 */
function questionFocusTerms(question) {
  const words = String(question || "").toLowerCase().split(/[^a-zà-ỹ0-9]+/).filter((w) => w.length > 3);
  return words.filter((w) => ADVERSE_OUTCOME_RE.test(w) || FAVOURABLE_NOUN_RE.test(w));
}

/**
 * Does a reported direction answer the question affirmatively?
 *
 * For an adverse outcome (mortality, events, relapse) a reduction is the
 * favourable result; for a desirable one (survival, function, adherence) an
 * increase is.
 *
 * @param {"down"|"up"|"none"} reported
 * @param {"down"|"up"|"benefit"} asked
 * @param {boolean} adverseOutcome
 * @returns {boolean|null}
 */
export function isFavourable(reported, asked, adverseOutcome) {
  if (reported === "none") return null;
  if (asked === "down") return reported === "down";
  if (asked === "up") return reported === "up";
  // "Is X effective?" — resolve against the nature of the outcome.
  return adverseOutcome ? reported === "down" : reported === "up";
}

export default { classifyStance, extractConclusionText, parseEffectEstimates, parseQuestion, readSentence, parsePValue, splitSentences, isFavourable };
