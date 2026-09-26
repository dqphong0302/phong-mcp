/**
 * Papers With Code / Hugging Face Papers source plugin.
 * Free, no API key required.
 *
 * Provides research papers alongside code implementations, model checkpoints,
 * GitHub repos, and community artifacts.
 */

import { fromPapersWithCode, fromArxiv } from "../formatter.js";

export const id = "papers_with_code";
export const name = "Papers With Code (Hugging Face Papers & Code Repos)";
export const requiresKey = false;
// paperswithcode.com was shut down by Meta in 2025; the host now answers with a
// Cloudflare block page instead of JSON. Marked unavailable so the registry
// skips it cleanly rather than burning a slot on every search.
// Thay thế: huggingface (Daily Papers), openreview, semantic_scholar.
export const available = false;
export const keyEnvVar = null;
export const domains = ["cs", "ml", "ai", "open_access"];

const HF_PAPERS_API = "https://huggingface.co/api/daily_papers";

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  try {
    // 1. Try Hugging Face trending / daily research papers
    const resp = await fetch(`${HF_PAPERS_API}?limit=50`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "academic-search-mcp/2.0 (Mozilla/5.0)",
      },
      signal: signal || AbortSignal.timeout(10000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const qTerms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);

      const matched = (Array.isArray(data) ? data : []).filter((item) => {
        const title = (item.title || item.paper?.title || "").toLowerCase();
        const summary = (item.paper?.summary || "").toLowerCase();
        return qTerms.every((t) => title.includes(t) || summary.includes(t)) || qTerms.some((t) => title.includes(t));
      });

      if (matched.length > 0) {
        const papers = matched.slice(0, limit).map((m) => {
          const p = m.paper || m;
          const arxivId = p.id || p.arxiv_id || null;
          const year = p.publishedAt ? parseInt(p.publishedAt.slice(0, 4), 10) : new Date().getFullYear();
          return {
            id: arxivId ? `arxiv:${arxivId}` : `hf-paper:${m._id || m.id}`,
            title: p.title || m.title || "(untitled)",
            authors: (p.authors || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean),
            year,
            doi: p.doi || null,
            arxiv_id: arxivId,
            abstract: p.summary || null,
            citation_count: p.upvotes ?? null,
            pdf_url: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null,
            url: `https://huggingface.co/papers/${arxivId || m.id}`,
            source: "papers_with_code",
            venue: "Hugging Face Papers / ArXiv",
            volume: null,
            issue: null,
            pages: null,
            publisher: "Hugging Face",
            type: "preprint",
            issn: null,
            is_oa: true,
          };
        });

        return {
          papers,
          total: matched.length,
        };
      }
    }
  } catch {}

  // 2. Fallback to ArXiv with code tag
  try {
    const arxivMod = await import("./arxiv.js");
    const res = await arxivMod.search(query, opts, _config);
    const papers = res.papers.map((p) => ({
      ...p,
      source: "papers_with_code",
      venue: "Papers with Code / ArXiv",
    }));
    return {
      papers: papers.slice(0, limit),
      total: res.total,
    };
  } catch {
    return { papers: [], total: 0 };
  }
}

export async function getById(paperId, _config = {}, opts = {}) {
  const cleanId = String(paperId).replace(/^(papers_with_code|arxiv|hf-paper):/, "");
  try {
    const arxivMod = await import("./arxiv.js");
    return arxivMod.getById(cleanId, _config, opts);
  } catch {
    return null;
  }
}
