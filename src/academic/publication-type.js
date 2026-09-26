/**
 * Does a record actually report findings?
 *
 * Search engines return protocols, trial registrations, editorials and errata
 * alongside completed studies. None of them can answer a research question —
 * a protocol describes what a team *will* do — yet they read like research to
 * a text classifier and end up voting in an evidence synthesis. A search for
 * semaglutide and cardiovascular events returned the SELECT trial's "rationale
 * and design" paper as supporting evidence, years before it had any results.
 *
 * No upstream supplies usable publication-type metadata here (the PubMed
 * adapter hardcodes type "article"), so this is detected from the text.
 */

/** Ordered most-specific first; the first match wins. */
const RULES = [
  ["correction", /\b(?:erratum|corrigendum|correction to|author correction|publisher correction|retraction of|retracted:|expression of concern|withdrawn:)\b/i],
  ["editorial",  /\b(?:letter to the editor|editorial(?: comment)?|comment on|commentary on|reply to|response to the letter|author'?s? reply|in this issue)\b/i],
  ["protocol",   /\b(?:study protocol|a protocol for|this is a protocol for|protocol for a (?:systematic review|randomi[sz]ed|cochrane)|rationale and design|design and rationale|design of (?:the|a) [\w\s-]{0,30}(?:trial|study)|statistical analysis plan|trial protocol|the objectives? (?:are|is) as follows)\b/i],
  ["registration", /^\s*\[clinical trial\s+(?:nct|isrctn)/i],
];

/**
 * Future-tense methods are the give-away for a protocol whose title does not
 * say so: completed studies report what happened, protocols what will happen.
 */
const FUTURE_METHODS_RE =
  /\b(?:will be (?:recruit|random|enrol|assign|includ|assess|measur|analys|analyz|collect|follow)\w*|we will (?:recruit|randomi[sz]e|enrol|assess|measure|analys|analyz|compare|collect|include)|participants will|patients will be|data will be|the primary outcome will be)\b/i;

/**
 * Classify a record as reporting results or not.
 *
 * @param {Object} paper
 * @returns {{ reports: boolean, kind: string|null }}
 */
export function reportsResults(paper) {
  const title = String(paper?.title || "");
  const abstract = String(paper?.abstract || "");
  const haystack = `${title} ${abstract}`;

  // Registry records describe a study's existence, not its findings.
  if (paper?.source === "clinicaltrials" || paper?.source === "isrctn" || paper?.type === "clinical_trial") {
    return { reports: false, kind: "registration" };
  }

  for (const [kind, re] of RULES) {
    // Corrections and editorials announce themselves in the title; a protocol
    // may only be identifiable from the abstract.
    const scope = kind === "correction" || kind === "editorial" || kind === "registration" ? title : haystack;
    if (re.test(scope)) return { reports: false, kind };
  }

  if (FUTURE_METHODS_RE.test(abstract) && !/\b(?:we found|we observed|results showed|conclusions?:)/i.test(abstract)) {
    return { reports: false, kind: "protocol" };
  }

  return { reports: true, kind: null };
}

export default { reportsResults };
