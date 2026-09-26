/**
 * Obsidian Map of Content (MOC) & Zettelkasten Knowledge Synthesizer.
 * Generates structured index notes, hierarchical clusters, and bi-directional [[WikiLinks]]
 * for academic research notes in the Obsidian Vault.
 */

/**
 * Generate a Map of Content (MOC) note for Obsidian.
 *
 * @param {Object} input
 * @param {string} input.topic Topic name (e.g. "Medical AI Diagnostic Evaluation")
 * @param {Array<Object>} input.papers Array of papers { id, title, year, venue, authors, doi, key_takeaway, tags }
 * @param {Array<string>} [input.subtopics] Optional subtopics / themes
 * @param {string} [input.summary] Executive synthesis of the research cluster
 * @returns {Object} { filename: string, content: string, link_count: number }
 */
export function generateObsidianMoc(input = {}) {
  const topic = input.topic || "Academic Research MOC";
  const papers = input.papers || [];
  const subtopics = input.subtopics || [];
  const summary = input.summary || "Synthesized literature index and knowledge map.";

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeTopicSlug = topic
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  const filename = `MOC - ${safeTopicSlug}.md`;

  let content = `---
type: moc
topic: "${topic}"
created: ${dateStr}
total_papers: ${papers.length}
tags:
  - academic-research
  - moc
  - second-brain
---

# 🗺️ Map of Content: ${topic}

> **Overview**: ${summary}
> **Last Updated**: ${dateStr} | **Total Records**: ${papers.length}

---

## 📌 Core Research Themes & Subtopics
`;

  if (subtopics.length > 0) {
    for (const st of subtopics) {
      content += `### 🔹 ${st}\n`;
      const relevant = papers.filter((p) => (p.tags || []).some((t) => t.toLowerCase().includes(st.toLowerCase())));
      if (relevant.length > 0) {
        for (const p of relevant) {
          const authors = (p.authors || []).slice(0, 2).join(" & ") || "Author";
          content += `- [[${p.title}]] — *${authors} (${p.year || "n.d."})* [${p.venue || "Journal"}]\n`;
          if (p.key_takeaway) content += `  - 💡 *Key finding*: ${p.key_takeaway}\n`;
        }
      } else {
        content += `- *(No papers indexed for this theme yet)*\n`;
      }
      content += `\n`;
    }
  }

  content += `## 📚 Indexed Papers & Evidence Matrix\n\n`;
  content += `| Paper Title / Note | Authors | Year | Venue | DOI / Link |\n`;
  content += `|:---|:---|:---:|:---|:---:|\n`;

  for (const p of papers) {
    const authors = (p.authors || []).slice(0, 2).join(" & ") || "Author";
    const doiLink = p.doi ? `[DOI](https://doi.org/${p.doi})` : (p.url ? `[Link](${p.url})` : "—");
    content += `| [[${p.title}]] | ${authors} | ${p.year || "—"} | ${p.venue || "—"} | ${doiLink} |\n`;
  }

  content += `\n---\n\n## 🔗 Related Knowledge Hubs & MOCs\n`;
  content += `- [[MOC - Master Research Index]]\n`;
  content += `- [[Literature Review Workflow]]\n`;
  content += `- [[Research Ideas & Hypotheses]]\n`;

  return {
    filename,
    content,
    link_count: papers.length,
  };
}
