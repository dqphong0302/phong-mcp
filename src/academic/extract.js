/**
 * Academic Extract — Elicit-inspired structured data extraction.
 *
 * Given a list of paper IDs, extracts structured dimensions from
 * each paper's abstract/tldr and returns a comparison table.
 *
 * Approach: heuristic NLP patterns on abstract text (no LLM call).
 * Inspired by: Elicit.com structured extraction table feature.
 */

import { lookupPaper } from "./orchestrator.js";

// ── Dimension extractors ──────────────────────────────────────────────────────

/**
 * Each extractor: (text: string) => string|null
 * text = abstract + tldr combined, lowercased
 */
const DIMENSION_EXTRACTORS = {

  sample_size: (text) => {
    const m = text.match(/\bn\s*=\s*([\d,]+)|(\d[\d,]*)\s*(participants?|subjects?|patients?|cases?|individuals?|respondents?)/i);
    if (!m) return null;
    return (m[1] || m[2])?.replace(/,/g, "") || null;
  },

  study_type: (text) => {
    if (/randomized controlled trial|rct\b/.test(text)) return "RCT";
    if (/systematic review/.test(text)) return "Systematic Review";
    if (/meta.?analysis/.test(text)) return "Meta-analysis";
    if (/cohort study/.test(text)) return "Cohort Study";
    if (/case.control/.test(text)) return "Case-Control";
    if (/cross.sectional/.test(text)) return "Cross-sectional";
    if (/observational/.test(text)) return "Observational";
    if (/qualitative/.test(text)) return "Qualitative";
    if (/survey/.test(text)) return "Survey";
    if (/randomized/.test(text)) return "Randomized Trial";
    if (/experiment/.test(text)) return "Experimental";
    if (/review/.test(text)) return "Review";
    return null;
  },

  outcome: (text) => {
    const patterns = [
      /(?:primary )?outcome[s]?(?:\s+(?:was|were|included?))?\s*:?\s*([^.]{10,80})/i,
      /(?:we|study)\s+(?:found|observed|showed?|demonstrated?)\s+(?:that\s+)?([^.]{10,80})/i,
      /(?:results?|findings?)\s+(?:showed?|indicated?|suggested?|revealed?)\s+(?:that\s+)?([^.]{10,80})/i,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m?.[1]) return m[1].trim().slice(0, 120);
    }
    return null;
  },

  method: (text) => {
    const patterns = [
      /(?:using?|employing?|with|via|based on)\s+([\w\s-]{5,50}(?:model|network|algorithm|method|approach|framework|technique|analysis|regression|transformer|bert|gpt|llm))/i,
      /(?:method|approach|technique)s?\s*(?:was|were|used|employed)?\s*:?\s*([^.]{10,80})/i,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m?.[1]) return m[1].trim().slice(0, 100);
    }
    return null;
  },

  dataset: (text) => {
    const m = text.match(/(?:dataset|data\s*set|corpus|benchmark)\s*(?:called|named|:)?\s*([\w\s-]{3,50}?)(?:\s+(?:dataset|corpus|benchmark|consisting|containing|with|of)|\.|,)/i);
    return m?.[1]?.trim() || null;
  },

  conclusion: (text) => {
    const patterns = [
      /(?:in conclusion|to conclude|we conclude|our results? suggest|this study suggests?|findings? suggest)[,:]?\s*(?:that\s+)?([^.]{15,200})/i,
      /(?:overall|taken together)[,:]?\s*(?:these\s+(?:results?|findings?)\s+)?([^.]{15,200})/i,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m?.[1]) return m[1].trim().slice(0, 200);
    }
    return null;
  },

  limitations: (text) => {
    const m = text.match(/(?:limitation[s]?|caveat[s]?|drawback[s]?)\s*(?:of this study|include|include[sd]?|are|is)?\s*:?\s*([^.]{10,150})/i);
    return m?.[1]?.trim().slice(0, 150) || null;
  },

  year: (paper) => paper.year ? String(paper.year) : null,

  citations: (paper) => paper.citation_count != null ? String(paper.citation_count) : null,

  venue: (paper) => paper.venue || null,

  open_access: (paper) => paper.is_oa ? "✅ Yes" : "❌ No",
};

// Dimensions that take the full paper object (not just text)
const PAPER_LEVEL_DIMS = new Set(["year", "citations", "venue", "open_access"]);

// ── Extract from single paper ─────────────────────────────────────────────────

/**
 * Extract requested dimensions from a single paper.
 * @param {import("./formatter.js").AcademicPaper} paper
 * @param {string[]} dimensions
 * @returns {Object} - { dimension: value|null }
 */
export function extractFromPaper(paper, dimensions) {
  const text = [paper.tldr, paper.abstract].filter(Boolean).join(" ").toLowerCase();
  const result = {};
  for (const dim of dimensions) {
    if (PAPER_LEVEL_DIMS.has(dim)) {
      result[dim] = DIMENSION_EXTRACTORS[dim]?.(paper) ?? null;
    } else if (DIMENSION_EXTRACTORS[dim]) {
      result[dim] = DIMENSION_EXTRACTORS[dim](text);
    } else {
      // Custom dimension: keyword search in abstract
      const re = new RegExp(`(?:${dim.replace(/_/g, "[\\s_-]?")})\\s*[:\\-]?\\s*([^.]{10,120})`, "i");
      const m = text.match(re);
      result[dim] = m?.[1]?.trim().slice(0, 120) || null;
    }
  }
  return result;
}

// ── Format as table ───────────────────────────────────────────────────────────

/**
 * Format extracted results as a markdown comparison table.
 * @param {Array<{paper, extracted}>} results
 * @param {string[]} dimensions
 * @param {"table"|"json"|"markdown"} outputFormat
 * @returns {string}
 */
export function formatExtractResults(results, dimensions, outputFormat = "table") {
  if (!results.length) return "No papers could be extracted.";

  if (outputFormat === "json") {
    return "```json\n" + JSON.stringify(
      results.map(({ paper, extracted }) => ({
        title: paper.title,
        year: paper.year,
        doi: paper.doi,
        ...extracted,
      })),
      null, 2
    ) + "\n```";
  }

  if (outputFormat === "table") {
    // Markdown table
    const header = ["Paper", "Year", ...dimensions];
    const divider = header.map(() => "---");
    const rows = results.map(({ paper, extracted }) => {
      const title = paper.doi
        ? `[${_truncate(paper.title, 50)}](https://doi.org/${paper.doi})`
        : _truncate(paper.title, 50);
      return [
        title,
        paper.year || "?",
        ...dimensions.map((d) => _truncate(extracted[d] || "—", 80)),
      ];
    });

    const lines = [
      `## Extraction Table (${results.length} papers × ${dimensions.length} dimensions)`,
      "",
      `| ${header.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ];

    // Add full details below table
    lines.push("", "---", "## Full Details", "");
    for (const { paper, extracted } of results) {
      lines.push(`### ${paper.title}`);
      if (paper.authors?.length) lines.push(`**Authors**: ${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""}`);
      if (paper.doi) lines.push(`**DOI**: https://doi.org/${paper.doi}`);
      if (paper.arxiv_id) lines.push(`**arXiv**: https://arxiv.org/abs/${paper.arxiv_id}`);
      lines.push("");
      for (const [dim, val] of Object.entries(extracted)) {
        if (val) lines.push(`**${dim.replace(/_/g, " ")}**: ${val}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  // Markdown (verbose per-paper sections)
  const lines = [`## Extraction Results (${results.length} papers)`, ""];
  for (const { paper, extracted } of results) {
    lines.push(`### ${paper.title}`);
    if (paper.authors?.length) lines.push(`**Authors**: ${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""}`);
    if (paper.doi) lines.push(`**DOI**: https://doi.org/${paper.doi}`);
    if (paper.arxiv_id) lines.push(`**arXiv**: https://arxiv.org/abs/${paper.arxiv_id}`);
    lines.push("");
    for (const [dim, val] of Object.entries(extracted)) {
      lines.push(`**${dim.replace(/_/g, " ")}**: ${val || "—"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function _truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Extract structured data from a list of papers.
 *
 * @param {string[]} paperIds       - DOI/arXiv/PMID/S2 IDs
 * @param {string[]} dimensions     - dimensions to extract
 * @param {"table"|"json"|"markdown"} outputFormat
 * @param {Object}   config
 * @returns {Promise<string>}
 */
export async function runExtract(paperIds, dimensions, outputFormat, config) {
  const BUILT_IN_DIMS = Object.keys(DIMENSION_EXTRACTORS);

  // Validate dimensions — warn about unknown ones
  const unknown = dimensions.filter(
    (d) => !BUILT_IN_DIMS.includes(d)
  );

  // Lookup papers with concurrency 3
  const CONCURRENCY = 3;
  const results = [];
  const errors = [];

  for (let i = 0; i < paperIds.length; i += CONCURRENCY) {
    const batch = paperIds.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (id) => {
        try {
          const paper = await lookupPaper(id.trim(), config, false);
          if (!paper) return { id, error: "Not found" };
          return { id, paper };
        } catch (e) {
          return { id, error: e.message };
        }
      })
    );
    for (const r of resolved) {
      if (r.error) errors.push(`- ${r.id}: ${r.error}`);
      else results.push({ paper: r.paper, extracted: extractFromPaper(r.paper, dimensions) });
    }
  }

  if (!results.length) {
    return `No papers could be fetched.\n${errors.join("\n")}`;
  }

  const output = [formatExtractResults(results, dimensions, outputFormat)];

  if (unknown.length) {
    output.push(`\n> ℹ️ Custom dimensions (keyword-matched): ${unknown.join(", ")}`);
  }
  output.push(`> Built-in dimensions available: ${BUILT_IN_DIMS.join(", ")}`);
  if (errors.length) {
    output.push(`\n> ⚠️ ${errors.length} papers failed:\n${errors.join("\n")}`);
  }

  return output.join("\n");
}
