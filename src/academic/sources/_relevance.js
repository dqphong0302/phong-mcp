/**
 * Shared query-relevance scoring for sources that cannot search server-side.
 *
 * A few upstreams expose no search endpoint at all — the bioRxiv/medRxiv API
 * only serves a date window, and some Vietnamese OJS portals only render their
 * latest issue. Those adapters must filter locally, and the naive way to do it
 * ("keep the record if ANY query word appears") lets a COVID preprint through
 * on the word "outcomes" and fills half the result set with noise.
 *
 * This module scores a record against the query by how much of the query it
 * actually covers, so a partial hit on one common word is rejected.
 */

/** Words that carry no retrieval signal. English + Vietnamese. */
const STOPWORDS = new Set([
  // English
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "are",
  "was", "were", "has", "have", "had", "its", "their", "our", "into", "onto",
  "than", "then", "such", "but", "not", "all", "any", "can", "may", "using",
  "use", "used", "via", "per", "between", "among", "during", "after", "before",
  "about", "study", "studies", "research", "paper", "article", "analysis",
  "based", "new", "novel", "review", "role", "effects", "effect",
  // Question words and function words. A question's phrasing says nothing
  // about its subject, so these must never be treated as anchor terms.
  "does", "did", "doe", "was", "were", "who", "whom", "whose", "what", "which",
  "how", "why", "when", "where", "will", "would", "could", "should", "shall",
  "in", "on", "at", "by", "to", "of", "or", "if", "it", "be", "as", "we", "us",
  "an", "is", "do", "cause", "causes", "caused", "versus", "compared",
  // Vietnamese, stored diacritic-folded to match tokenizeQuery's output
  "va", "cua", "trong", "cho", "voi", "cac", "nhung", "mot", "la", "co",
  "duoc", "tu", "den", "theo", "tren", "duoi", "ve", "khi", "nay", "do",
  "nghien", "cuu", "bai", "bao", "tai", "cung", "hoac", "nhu", "su", "viec",
]);

/**
 * Strip Vietnamese diacritics so "đái tháo đường" and "dai thao duong" match.
 * Applied to both sides of every comparison, so folding can never make one side
 * matchable and the other not.
 *
 * @param {string} s
 * @returns {string}
 */
export function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

/**
 * Vocabulary that is common to nearly every paper in a field and therefore
 * cannot identify a specific one. "Does metformin reduce mortality in type 2
 * diabetes?" shares patients/mortality/type/diabetes with thousands of papers;
 * only "metformin" pins down what is being asked about.
 */
const GENERIC_DOMAIN_TERMS = new Set([
  "patient", "patients", "adult", "adults", "people", "person", "human", "humans",
  "risk", "outcome", "outcomes", "mortality", "death", "survival", "incidence",
  "prevalence", "treatment", "therapy", "therapies", "management", "care",
  "clinical", "disease", "diseases", "disorder", "syndrome", "condition",
  "trial", "trials", "cohort", "randomized", "randomised", "controlled",
  "association", "associated", "efficacy", "safety", "evidence", "impact",
  "reduce", "reduces", "reduction", "increase", "improve", "improves",
  "type", "level", "levels", "rate", "rates", "score", "group", "groups",
  "intervention", "interventions", "drug", "drugs", "medication", "medications",
  "benh", "nhan", "dieu", "tri", "nguy", "hieu", "qua", "ty", "le",
]);

/**
 * The terms that actually identify what a question is about: content terms
 * minus the field's common vocabulary. Falls back to all content terms when
 * every word is generic.
 *
 * @param {string} query
 * @returns {string[]}
 */
export function anchorTerms(query) {
  const terms = tokenizeQuery(query);
  const anchors = terms.filter((t) => !GENERIC_DOMAIN_TERMS.has(t));
  return anchors.length ? anchors : terms;
}

/**
 * Is this word pure noise for retrieval purposes? Accepts either spelling —
 * the word is folded before the lookup.
 *
 * @param {string} word
 * @returns {boolean}
 */
export function isStopword(word) {
  return STOPWORDS.has(fold(word));
}

/**
 * Content terms in their ORIGINAL spelling, stopwords removed.
 *
 * Needed by upstreams that match diacritics literally (the Vietnamese OJS
 * portals return nothing for "dai thao duong" but plenty for "đái tháo đường"),
 * where the folded terms from tokenizeQuery cannot be sent as-is.
 *
 * @param {string} query
 * @returns {string[]}
 */
export function contentTermsRaw(query) {
  const out = [];
  const seen = new Set();
  for (const w of String(query || "").split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const f = fold(w);
    if (f.length < 3 || STOPWORDS.has(f) || seen.has(f)) continue;
    seen.add(f);
    out.push(w);
  }
  return out;
}

/**
 * Split a query into the content terms worth matching on.
 *
 * @param {string} query
 * @returns {string[]} deduplicated, diacritic-folded terms
 */
export function tokenizeQuery(query) {
  const raw = fold(query)
    // Keep letters and digits; everything else separates terms.
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const terms = [];
  const seen = new Set();
  for (const w of raw) {
    // Below three characters nothing survives that is worth matching on:
    // single digits ("2" in "type 2 diabetes") and English function words
    // ("in", "of") only add noise, and Vietnamese content words are longer.
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    terms.push(w);
  }
  return terms;
}

/** Escape a term for safe use inside a RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fraction of the query's content terms present in `text`, with a bonus when
 * the full query phrase appears verbatim.
 *
 * @param {string} text
 * @param {string[]} terms   from tokenizeQuery
 * @param {string} [phrase]  the original query, for the verbatim bonus
 * @returns {number} 0..1.2
 */
export function relevanceScore(text, terms, phrase = "") {
  if (!terms.length) return 1;
  const hay = fold(text);
  if (!hay) return 0;

  // Whole-word matching. A substring test would score "tri" against "trung"
  // and let an unrelated Vietnamese title pass the coverage threshold.
  let hits = 0;
  for (const t of terms) {
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(t)}(?:[^\\p{L}\\p{N}]|$)`, "u").test(hay)) hits++;
  }

  let score = hits / terms.length;
  const p = fold(phrase).trim();
  if (p.length > 8 && hay.includes(p)) score += 0.2;
  return score;
}

/**
 * Keep only the records that genuinely match the query, best first.
 *
 * @param {Array<T>} items
 * @param {string} query
 * @param {Object}   opts
 * @param {(item: T) => string} opts.getText    text to match against
 * @param {(item: T) => string} [opts.getTitle] title, weighted higher
 * @param {number} [opts.minCoverage=0.6]       fraction of terms required
 * @returns {T[]}
 * @template T
 */
export function filterByRelevance(items, query, opts = {}) {
  const { getText, getTitle, minCoverage = 0.6, requireAnchors = false } = opts;
  const terms = tokenizeQuery(query);
  // When anchors are required, a record must mention what the question is
  // actually about — not merely enough of its generic vocabulary. Without this
  // a question about metformin accepts papers about SGLT2 inhibitors purely on
  // "patients / mortality / type / diabetes".
  const anchors = requireAnchors ? anchorTerms(query) : [];
  // Research questions are phrased "does <subject> do <something>", so the
  // first anchor names what is being asked about. Requiring it stops a question
  // about semaglutide from being answered by a paper that merely shares the
  // outcome vocabulary ("cardiovascular", "adverse", "events").
  // Requiring the subject is enough on its own; `minCoverage` above already
  // enforces breadth. Demanding a share of the remaining anchors on top of it
  // over-fits to the question's exact wording — "major adverse cardiovascular
  // events" becomes four separate requirements, and a paper that says
  // "cardiovascular outcomes" instead is rejected despite being on point.
  const subject = anchors[0] || null;
  // Nothing to match on (e.g. a query of only stopwords) — pass through rather
  // than silently returning an empty result set.
  if (terms.length === 0) return [...items];

  const scored = [];
  for (const item of items) {
    const body = getText ? getText(item) : String(item ?? "");
    const title = getTitle ? getTitle(item) : "";
    const bodyScore = relevanceScore(body, terms, query);
    const titleScore = title ? relevanceScore(title, terms, query) : 0;
    // A title hit is the stronger signal; the body keeps a partial match alive.
    const score = Math.max(bodyScore, titleScore * 1.1);
    if (score < minCoverage) continue;

    if (subject && relevanceScore(`${title} ${body}`, [subject]) < 1) continue;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

export default { fold, isStopword, anchorTerms, contentTermsRaw, tokenizeQuery, relevanceScore, filterByRelevance };
