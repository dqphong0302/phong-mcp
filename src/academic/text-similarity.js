/**
 * Zero-Token Text Similarity & Deduplication Engine
 * Uses Levenshtein Distance and N-gram Jaccard Similarity.
 */

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function getNgrams(words, n = 2) {
  const ngrams = new Set();
  if (words.length < n) {
    if (words.length > 0) ngrams.add(words.join(" "));
    return ngrams;
  }
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

export function jaccardSimilarity(textA, textB, ngramSize = 2) {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  if (!wordsA.length && !wordsB.length) return 1.0;
  if (!wordsA.length || !wordsB.length) return 0.0;

  const ngramsA = getNgrams(wordsA, ngramSize);
  const ngramsB = getNgrams(wordsB, ngramSize);

  let intersection = 0;
  for (const item of ngramsA) {
    if (ngramsB.has(item)) intersection++;
  }

  const union = ngramsA.size + ngramsB.size - intersection;
  return union === 0 ? 0.0 : round(intersection / union, 4);
}

export function levenshteinRatio(s1, s2) {
  const str1 = String(s1 || "").toLowerCase().trim();
  const str2 = String(s2 || "").toLowerCase().trim();

  if (str1 === str2) return 1.0;
  if (!str1.length || !str2.length) return 0.0;

  const m = str1.length;
  const n = str2.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const maxLen = Math.max(m, n);
  const distance = d[m][n];
  return round(1.0 - distance / maxLen, 4);
}

function round(val, dec = 3) {
  return Number(Math.round(val + "e" + dec) + "e-" + dec);
}

export function compareTexts(textA, textB) {
  const jaccard = jaccardSimilarity(textA, textB, 2);
  const charRatio = textA.length < 500 && textB.length < 500 ? levenshteinRatio(textA, textB) : null;
  const combinedScore = charRatio != null ? round(jaccard * 0.6 + charRatio * 0.4, 3) : jaccard;

  return {
    similarity_score: combinedScore,
    is_duplicate: combinedScore >= 0.85,
    jaccard_bigram: jaccard,
    levenshtein_ratio: charRatio,
  };
}

export function deduplicateList(items, keyExtractor = (x) => x.title || x, threshold = 0.85) {
  const unique = [];
  const duplicates = [];

  for (const item of items) {
    const text = keyExtractor(item);
    let matched = false;

    for (const u of unique) {
      const uText = keyExtractor(u);
      const sim = jaccardSimilarity(text, uText, 2);
      if (sim >= threshold) {
        duplicates.push({
          duplicate_item: item,
          matched_with: u,
          similarity: sim,
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      unique.push(item);
    }
  }

  return {
    total_input: items.length,
    unique_count: unique.length,
    duplicate_count: duplicates.length,
    unique_items: unique,
    duplicates,
  };
}
