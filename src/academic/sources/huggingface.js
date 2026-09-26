/**
 * Hugging Face Daily Papers source plugin.
 * Free, no API key required.
 * API: https://huggingface.co/api/daily_papers
 */
import { fromHuggingFace } from "../formatter.js";

export const id = "huggingface";
export const name = "Hugging Face Daily Papers";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["cs", "ml", "ai"];

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  try {
    const resp = await fetch("https://huggingface.co/api/daily_papers", {
      headers: { Accept: "application/json" },
      signal: signal || AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    if (!Array.isArray(data)) return { papers: [], total: 0 };

    const qLower = query.toLowerCase();
    const matches = data.filter((item) => {
      const p = item.paper || item;
      const title = p.title || "";
      const summary = p.summary || "";
      return title.toLowerCase().includes(qLower) || summary.toLowerCase().includes(qLower);
    });

    const results = (matches.length ? matches : data).slice(0, limit);
    return {
      papers: results.map(fromHuggingFace),
      total: data.length,
    };
  } catch (e) {
    return { papers: [], total: 0 };
  }
}
