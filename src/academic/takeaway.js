/**
 * 1-Sentence Takeaway Generator
 * Generates an instant, concise finding/takeaway sentence for any paper.
 * Inspired by Elicit's query-focused takeaway feature.
 */

export function generateTakeaway(paper, query = "") {
  if (!paper) return null;

  // 1. If paper already has a high-quality S2 TLDR, prioritize it
  if (paper.tldr && typeof paper.tldr === "string" && paper.tldr.trim().length > 15) {
    let t = paper.tldr.trim();
    if (!/[.!?]$/.test(t)) t += ".";
    return t;
  }

  const abstract = paper.abstract || "";
  if (!abstract || typeof abstract !== "string" || abstract.length < 30) {
    return null;
  }

  // 2. Clean abstract text
  const cleanAbs = abstract
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Split into sentences using punctuation boundaries
  const sentences = cleanAbs
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  if (sentences.length === 0) return null;

  // 3. Look for explicit Conclusion / Findings sentences
  const conclusionKeywords = [
    /\b(conclusions?|in conclusion|to conclude)\b/i,
    /\b(results? (?:showed|demonstrated?|indicated?|suggested?|revealed?))\b/i,
    /\b(our (?:results?|findings?|data) (?:showed?|demonstrated?|indicate|suggest))\b/i,
    /\b(we (?:found|observed|showed?|demonstrated?|conclude) that)\b/i,
    /\b(this study (?:demonstrates?|shows?|indicates?|provides evidence))\b/i,
    /\b(overall,? (?:these findings|the results))\b/i,
  ];

  for (const regex of conclusionKeywords) {
    // Check backwards from the end of the abstract where conclusions usually are
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i];
      if (regex.test(s)) {
        // Strip leading section markers like "CONCLUSIONS: " or "RESULTS: "
        let cleanSentence = s.replace(/^(conclusions?|results?|findings?|significance):\s*/i, "").trim();
        // Capitalize first letter
        cleanSentence = cleanSentence.charAt(0).toUpperCase() + cleanSentence.slice(1);
        if (cleanSentence.length > 180) {
          cleanSentence = cleanSentence.slice(0, 177) + "...";
        }
        if (!/[.!?]$/.test(cleanSentence)) cleanSentence += ".";
        return cleanSentence;
      }
    }
  }

  // 4. Fallback: Take the last sentence of the abstract (standard academic paper summary)
  let lastSentence = sentences[sentences.length - 1]
    .replace(/^(conclusions?|results?|findings?):\s*/i, "")
    .trim();
  lastSentence = lastSentence.charAt(0).toUpperCase() + lastSentence.slice(1);
  if (lastSentence.length > 180) {
    lastSentence = lastSentence.slice(0, 177) + "...";
  }
  if (!/[.!?]$/.test(lastSentence)) lastSentence += ".";
  return lastSentence;
}
