/**
 * search — Search & Deep-Reading tools for phong-mcp.
 * 
 * Pipeline:
 *   1. SearXNG on 9router (Fast, Free, Private Metasearch: web, news, science, it).
 *   2. Jina Reader (https://r.jina.ai/) -> fetches clean, ad-free Markdown of top pages.
 *   3. Scrapling Stealth Sidecar -> fallback for bot-protected or Cloudflare-gated pages.
 */
import type { Dict, Raw } from "../academic/types.ts";
import { z } from "zod";
import { request } from "undici";
import { NINE_ROUTER_API_KEY, scrapling } from "../config.ts";
import { ok, err, fmtErr } from "../utils.ts";

const SEARCH_BASE_URL = (
  process.env.NINE_ROUTER_BASE_URL ||
  process.env["9ROUTER_BASE_URL"] ||
  "https://9router.phongdang.io.vn/v1"
).replace(/\/$/, "");

const TIMEOUT_MS = 25_000;

async function fetchJinaReader(url: Raw) {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await request(jinaUrl, {
      method: "GET",
      headers: {
        accept: "text/markdown",
        "user-agent": "phong-mcp/search (+https://github.com/phongdang/home-server)",
      },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const text = await res.body.text();
      if (text && text.trim().length > 100) {
        return { success: true, text: text.trim(), source: "jina" };
      }
    }
  } catch {
    // ignore, try fallback
  }

  // Fallback to Scrapling stealth sidecar if available
  try {
    const sidecarUrl = `${scrapling.sidecarUrl}/v1/scrape`;
    const res = await request(sidecarUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        stealth: true,
        render_js: false,
        format: "markdown",
        max_length: 20000,
        extract_article: true,
      }),
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const data = (await res.body.json() as Raw);
      const content = data.markdown || data.content || data.text || "";
      if (content && content.trim().length > 100) {
        return { success: true, text: content.trim(), source: "scrapling" };
      }
    }
  } catch {
    // ignore
  }

  return { success: false, text: "", source: "none" };
}

export async function executeSearXNGSearch({ query, max_results = 5, search_type = "web", language, time_range }: Dict) {
  const apiKey = NINE_ROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY || "";
  const searchEndpoint = `${SEARCH_BASE_URL}/search`;

  const payload: Dict = {
    model: "searxng",
    query,
    search_type,
    max_results,
  };
  if (language) payload.language = language;
  if (time_range) payload.time_range = time_range;

  const res = await request(searchEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });

  if (res.statusCode !== 200) {
    const rawErr = await res.body.text();
    throw new Error(`SearXNG request failed with status ${res.statusCode}: ${rawErr}`);
  }

  const data = (await res.body.json() as Raw);
  return data.results || [];
}

export function registerSearchTools(server: Raw) {
  // ---------------------------------------------------------------------------
  // Tool 1: searxng_search (Fast, zero-cost, multi-category metasearch)
  // ---------------------------------------------------------------------------
  server.tool(
    "searxng_search",
    "Fast, private, zero-cost metasearch via 9router SearXNG across Google, Bing, DuckDuckGo, Brave, arXiv, GitHub, etc. Supports categories: 'web', 'news', 'science' (academic/papers), 'it' (code/docs).",
    {
      query: z.string().describe("Search query / keywords"),
      search_type: z
        .enum(["web", "news", "science", "it"])
        .optional()
        .describe("Search category: 'web' (default), 'news' (live news), 'science' (academic & research), or 'it' (code, tech docs, GitHub)"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum search results to return (default: 5)"),
      language: z
        .string()
        .optional()
        .describe("Language / region code (e.g. 'vi-VN', 'en-US', 'all')"),
      time_range: z
        .enum(["day", "week", "month", "year"])
        .optional()
        .describe("Filter results by time range ('day', 'week', 'month', 'year')"),
    },
    async ({ query, search_type, max_results, language, time_range }: Raw) => {
      try {
        const type = search_type ?? "web";
        const limit = max_results ?? 5;
        const results = await executeSearXNGSearch({ query, max_results: limit, search_type: type, language, time_range });

        if (results.length === 0) {
          return ok(`No results found for query: "${query}" (category: ${type})`);
        }

        let md = `# SearXNG Search Results: "${query}"\n\n`;
        md += `*Engine: SearXNG (9router) | Category: ${type} | Results: ${results.length}*\n\n`;

        results.forEach((r: Raw, idx: Raw) => {
          md += `### ${idx + 1}. [${r.title}](${r.url})\n`;
          if (r.snippet) md += `> ${r.snippet}\n\n`;
          const metaParts = [];
          if (r.display_url) metaParts.push(`Domain: \`${r.display_url}\``);
          if (r.published_at) metaParts.push(`Published: ${r.published_at}`);
          if (r.metadata?.source_type) metaParts.push(`Sources: ${r.metadata.source_type}`);
          if (metaParts.length) md += `*${metaParts.join(" | ")}*\n\n`;
        });

        return {
          ...ok(md),
          structuredContent: {
            query,
            search_type: type,
            total_results: results.length,
            results,
          },
        };
      } catch (e) {
        return err(`searxng_search failed: ${fmtErr(e)}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2: web_search_and_read (Unified pipeline: SearXNG + Jina / Scrapling Reader)
  // ---------------------------------------------------------------------------
  server.tool(
    "web_search_and_read",
    "Perform a fast, private web search via 9router SearXNG and deep-read top articles into clean Markdown using Jina Reader (with Scrapling stealth anti-bot fallback).",
    {
      query: z.string().describe("Search query / keywords"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum search results to return (default: 5)"),
      search_type: z
        .enum(["web", "news", "science", "it"])
        .optional()
        .describe("Type of search: 'web' (default), 'news', 'science', or 'it'"),
      read_top_n: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe(
          "Number of top search results to deep-read (default: 2, set 0 to disable)"
        ),
      language: z
        .string()
        .optional()
        .describe("Language / region code (e.g. 'vi-VN', 'en-US')"),
      time_range: z
        .enum(["day", "week", "month", "year"])
        .optional()
        .describe("Time filter ('day', 'week', 'month', 'year')"),
    },
    async ({ query, max_results, search_type, read_top_n, language, time_range }: Raw) => {
      const limit = max_results ?? 5;
      const type = search_type ?? "web";
      const deepReadCount = read_top_n ?? 2;

      try {
        const results = await executeSearXNGSearch({ query, max_results: limit, search_type: type, language, time_range });

        if (results.length === 0) {
          return ok(`No results found for query: "${query}" (category: ${type})`);
        }

        // Deep read top N results in parallel
        const toRead = results.slice(0, deepReadCount).filter((r: Raw) => Boolean(r.url));
        const deepReadPromises = toRead.map(async (item: Raw) => {
          const readRes = await fetchJinaReader(item.url);
          if (readRes.success && readRes.text) {
            return {
              title: item.title,
              url: item.url,
              reader: readRes.source,
              content: readRes.text.slice(0, 5000), // cap per article
            };
          }
          return null;
        });

        const deepReadRaw = await Promise.all(deepReadPromises);
        const deepReadResults = deepReadRaw.filter(Boolean);

        // Format Markdown output
        let md = `# Search Results for: "${query}"\n\n`;
        md += `*Engine: SearXNG (9router) | Category: ${type} | Total found: ${results.length}*\n\n`;

        md += `## 🔗 Quick Links & Snippets\n\n`;
        results.forEach((r: Raw, idx: Raw) => {
          md += `### ${idx + 1}. [${r.title}](${r.url})\n`;
          if (r.snippet) md += `> ${r.snippet}\n\n`;
          if (r.published_at) md += `*Published: ${r.published_at}*\n\n`;
        });

        if (deepReadResults.length > 0) {
          md += `\n---\n\n## 📖 Deep Read Content (${deepReadResults.length} articles)\n\n`;
          deepReadResults.forEach((dr, idx) => {
            md += `### [${idx + 1}] ${dr.title}\n`;
            md += `*Source: [${dr.url}](${dr.url}) | Extractor: ${dr.reader}*\n\n`;
            md += `${dr.content}\n\n---\n\n`;
          });
        }

        return {
          ...ok(md),
          structuredContent: {
            query,
            search_type: type,
            total_results: results.length,
            results,
            deep_read_articles: deepReadResults.map((d) => ({
              title: d.title,
              url: d.url,
              reader: d.reader,
              length: d.content.length,
            })),
          },
        };
      } catch (e) {
        return err(`web_search_and_read failed: ${fmtErr(e)}`);
      }
    }
  );
}
