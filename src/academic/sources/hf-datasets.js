/**
 * Hugging Face Datasets Hub source plugin.
 * Free, no API key required.
 * Docs: https://huggingface.co/docs/hub/api
 *
 * Provides: Machine Learning Datasets, multimodal benchmarks, likes, downloads, and tags.
 */

import { fromHfDataset } from "../formatter.js";

export const id = "hf_datasets";
export const name = "Hugging Face Datasets Hub";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["datasets", "machine_learning", "ai", "benchmarks", "nlp", "computer_vision"];

const BASE_URL = "https://huggingface.co/api/datasets";

/**
 * Search Hugging Face datasets.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [_config]
 */
export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, sort = "relevance" } = opts;
  const count = Math.min(limit, 25);

  const params = new URLSearchParams({
    search: query.trim(),
    limit: String(count),
    full: "true",
  });

  if (sort === "citations") params.set("sort", "likes");
  else if (sort === "recency") params.set("sort", "lastModified");

  try {
    const resp = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "phong-mcp-academic/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { papers: [], total: 0 };
    const datasets = await resp.json();
    if (!Array.isArray(datasets)) return { papers: [], total: 0 };

    const papers = datasets.map(fromHfDataset);

    return {
      papers: papers.slice(0, limit),
      total: datasets.length,
    };
  } catch (err) {
    console.warn("[hf_datasets] search error:", err.message);
    return { papers: [], total: 0 };
  }
}

export async function getById(datasetId, _config = {}) {
  const cleanId = datasetId.replace(/^hf-dataset:/i, "").trim();
  if (!cleanId) return null;

  try {
    const resp = await fetch(`${BASE_URL}/${encodeURIComponent(cleanId)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const dataset = await resp.json();
    return dataset && dataset.id ? fromHfDataset(dataset) : null;
  } catch {
    return null;
  }
}

export { search as searchHfDatasets };
