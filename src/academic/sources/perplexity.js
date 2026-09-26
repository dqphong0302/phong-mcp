/**
 * Perplexity Academic Search Source Plugin.
 * Real-time web-grounded academic literature discovery via Perplexity Sonar Pro.
 * Runs in parallel with national (Vietnam) and international academic sources.
 */

import { fromPerplexity } from "../formatter.js";
import { perplexity as perplexityConfig } from "../../config.js";

export const id = "perplexity";
export const name = "Perplexity Academic Discovery (Sonar Pro)";
export const requiresKey = true;
export const keyEnvVar = "PERPLEXITY_API_KEY";
export const domains = ["all", "science", "biomedical", "vietnam", "preprints", "grey_literature", "web"];

const TIMEOUT_MS = 25_000;

/**
 * Extract raw JSON array if wrapped in markdown code blocks.
 */
function extractJsonArray(text) {
  if (!text) return null;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = match ? match[1] : text;
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.results)) return parsed.results;
    if (parsed && Array.isArray(parsed.papers)) return parsed.papers;
  } catch {}
  return null;
}

/**
 * Perform search via Perplexity
 * @param {string} query
 * @param {Object} opts
 * @param {Object} config
 * @returns {Promise<{papers: Array, total: number}>}
 */
export async function search(query, opts = {}, config = {}) {
  const {
    limit = 10,
    year_min,
    year_max,
    signal,
  } = opts;

  const apiKey = config.perplexityApiKey || perplexityConfig.apiKey || process.env.PERPLEXITY_API_KEY || "";
  const baseUrl = (config.perplexityBaseUrl || perplexityConfig.baseUrl || process.env.PERPLEXITY_BASE_URL || "https://ai-proxy.phongdang.io.vn/perplexity/v1").replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY is not configured");
  }

  let prompt = `Find relevant peer-reviewed academic papers, conference proceedings, or scientific articles for the following query:\n"${query}"\n\n`;
  if (year_min || year_max) {
    prompt += `Filter by publication year: ${year_min || 1900} to ${year_max || new Date().getFullYear()}.\n`;
  }
  prompt += `Return up to ${limit} distinct scholarly papers.\n` +
    `Format the output strictly as a JSON array of objects with keys: "title", "authors" (array of strings), "year" (integer), "venue" (journal/conference), "abstract" (concise summary), "doi" (string or null), "url" (link), "pdf_url" (direct PDF link if open-access), "is_oa" (boolean). Output ONLY the JSON code block.`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "perplexity-pro",
      messages: [
        {
          role: "system",
          content: "You are an expert scientific search index. Return verified academic literature with accurate titles, authors, venues, DOIs, and URLs. Output only JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Perplexity API HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];

  const parsedArray = extractJsonArray(content);
  let papers = [];

  if (parsedArray && parsedArray.length > 0) {
    papers = parsedArray.map((p, idx) => {
      // Enrich with citation URLs if url is missing
      if (!p.url && citations[idx]) {
        p.url = citations[idx];
      }
      return fromPerplexity(p);
    });
  } else if (citations.length > 0) {
    // Fallback: build papers from citations & summary text
    papers = citations.slice(0, limit).map((citeUrl, idx) => fromPerplexity({
      title: `Academic Reference #${idx + 1} (${query})`,
      url: citeUrl,
      snippet: content.slice(0, 300),
    }));
  }

  return {
    papers: papers.slice(0, limit),
    total: papers.length,
  };
}
