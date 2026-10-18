import { errorMessage } from "../academic/errors.ts";
import type { Dict, Raw } from "../academic/types.ts";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { ok, err, fmtErr } from "../utils.ts";
import { searchUrls } from "../perplexity/index.ts";
import { executeSearXNGSearch } from "../search/index.ts";
import { distill as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

const MAX_SOURCES = 10;

// Heuristic: 1 token ≈ 4 chars for English/Vietnamese mix. Conservative.
const tokensToChars = (t: Raw) => t * 4;
const charsToTokens = (c: Raw) => Math.ceil(c / 4);

// ── Source loading ───────────────────────────────────────────────────────────
function classify(src: Raw) {
    if (/^https?:\/\//i.test(src)) return "url";
    if (src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src)) return "file";
    return "unknown";
}

function htmlToText(html: Raw) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, "\n")
        .replace(/<(br|hr)\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function loadUrl(url: Raw) {
    try {
        const resp = await proxyAwareFetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "distill-mcp/1.0 (+https://9router.phongdang.io.vn)",
                "Accept":     "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
            },
            timeout: 30000,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const ct  = (resp.headers.get("content-type") || "").toLowerCase();
        const raw = await resp.text();
        if (ct.includes("html")) return htmlToText(raw);
        if (ct.includes("json")) {
            try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
        }
        return raw;
    } catch (e) {
        throw new Error(`Failed to load URL: ${fmtErr(e)}`);
    }
}

async function loadFile(filePath: Raw) {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error(`Not a regular file: ${filePath}`);
    if (st.size > config.maxFileBytes) {
        throw new Error(`File too large: ${st.size} bytes > ${config.maxFileBytes} cap. Set DISTILL_MAX_FILE_BYTES env to override.`);
    }
    const buf = await readFile(filePath);
    // Reject obvious binary by null-byte presence in first 8KB
    const head = buf.subarray(0, Math.min(8192, buf.length));
    if (head.includes(0)) throw new Error("Binary file detected (contains NUL bytes). Convert to text first.");
    return buf.toString("utf8");
}

async function loadSource(src: Raw) {
    const kind = classify(src);
    if (kind === "url")  return { kind, content: await loadUrl(src),  ref: src };
    if (kind === "file") return { kind, content: await loadFile(src), ref: src };
    throw new Error(`Unrecognized source (must be http(s):// URL or absolute path): ${src}`);
}

function truncateToTokens(text: Raw, tokens: Raw) {
    const cap = tokensToChars(tokens);
    if (text.length <= cap) return { text, truncated: false };
    return { text: text.slice(0, cap), truncated: true };
}

export async function streamChat(messages: Raw, maxOutputTokens: Raw) {
    if (!config.apiKey) throw new Error("Missing NINE_ROUTER_API_KEY (or 9ROUTER_API_KEY) environment variable");

    let resp;
    try {
        resp = await proxyAwareFetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${config.apiKey}`,
                "Accept":        "text/event-stream",
            },
            body: JSON.stringify({
                model:       config.model,
                messages,
                stream:      true,
                max_tokens:  maxOutputTokens,
                temperature: 0.2,
            }),
            timeout: config.timeoutMs,
        });
    } catch (e) {
        throw new Error(`Network error calling 9router: ${errorMessage(e)}`);
    }
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`9router HTTP ${resp.status}: ${text.slice(0, 500)}`);
    }

    if (!resp.body) throw new Error("9router returned no response body");
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", parts = [], usage;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const d = t.slice(5).trim();
                if (!d || d === "[DONE]") continue;
                try {
                    const j = JSON.parse(d);
                    if (j.usage) usage = j.usage;
                    const delta = j.choices?.[0]?.delta?.content;
                    if (delta) parts.push(delta);
                } catch { /* skip */ }
            }
        }
    } finally {
        // cleanup reader if needed
    }
    return { content: parts.join(""), usage };
}

// ── Distill orchestration ────────────────────────────────────────────────────
async function distill({ question, sources, search_query, search_engine, search_type, search_max, max_output_tokens, language }: Raw) {
    let allSources = Array.isArray(sources) ? [...sources] : [];
    let searched = [];
    const engine = search_engine || "searxng";
    const type = search_type || "web";

    if (search_query) {
        try {
            if (engine === "searxng") {
                const results = await executeSearXNGSearch({
                    query: search_query,
                    max_results: Math.min(search_max || 5, 8),
                    search_type: type,
                });
                searched = results.map((r: Raw) => r.url).filter(Boolean);
            } else {
                searched = await searchUrls(search_query, Math.min(search_max || 5, 8), "phong-mcp");
            }
        } catch (e) {
            // Fallback between engines
            try {
                if (engine === "searxng") {
                    searched = await searchUrls(search_query, Math.min(search_max || 5, 8), "phong-mcp");
                } else {
                    const results = await executeSearXNGSearch({
                        query: search_query,
                        max_results: Math.min(search_max || 5, 8),
                        search_type: type,
                    });
                    searched = results.map((r: Raw) => r.url).filter(Boolean);
                }
            } catch (fallbackErr) {
                throw new Error(`search_query failed: ${fmtErr(e)} (fallback: ${fmtErr(fallbackErr)})`);
            }
        }
        // Prepend search hits in front of any caller-provided sources, dedupe.
        const seen = new Set();
        allSources = [...searched, ...allSources].filter(u => {
            if (seen.has(u)) return false;
            seen.add(u);
            return true;
        });
    }

    if (allSources.length === 0) {
        throw new Error("Provide either non-empty `sources` or a `search_query` (or both)");
    }
    if (allSources.length > MAX_SOURCES) {
        // Trim, keeping search results first then user-provided.
        allSources = allSources.slice(0, MAX_SOURCES);
    }
    const lang   = language || "vi";
    const maxOut = Math.min(Math.max(max_output_tokens || 800, 100), 4000);

    // Load all sources in parallel; collect failures inline rather than aborting.
    const loaded: Dict[] = await Promise.all(allSources.map(async (src, i) => {
        try {
            const r = await loadSource(src);
            return { i, ok: true, ...r };
        } catch (e) {
            return { i, ok: false, ref: src, error: fmtErr(e) };
        }
    }));

    const ok_sources = loaded.filter(s => s.ok);
    if (ok_sources.length === 0) {
        const msgs = loaded.map(s => `[${s.i + 1}] ${s.ref}: ${s.error}`).join("\n");
        throw new Error(`All sources failed to load:\n${msgs}`);
    }

    // Distribute the input budget across loaded sources.
    const perSource = Math.floor(config.inputBudgetTokens / ok_sources.length);
    const blocks = ok_sources.map(s => {
        const { text, truncated } = truncateToTokens(s.content, perSource);
        return {
            i:        s.i,
            ref:      s.ref,
            kind:     s.kind,
            text,
            truncated,
            chars:    s.content.length,
            tokens:   charsToTokens(text.length),
        };
    });

    const systemPrompt = lang === "en"
        ? "You answer the user's question using ONLY the provided sources. Cite sources inline with [1], [2], etc. matching the source numbers. If the sources do not contain enough information, say so explicitly. Be concise."
        : "Bạn trả lời câu hỏi CHỈ dựa trên các nguồn được cung cấp. Trích dẫn nguồn inline bằng [1], [2], ... theo đúng số thứ tự nguồn. Nếu nguồn không đủ thông tin, nói rõ. Trả lời ngắn gọn, đi thẳng vào vấn đề.";

    const userParts = [`Question: ${question}`, "", "Sources:"];
    blocks.forEach(b => {
        userParts.push(`\n--- [${b.i + 1}] ${b.ref}${b.truncated ? " (truncated)" : ""} ---`);
        userParts.push(b.text);
    });
    const userContent = userParts.join("\n");

    const { content, usage } = await streamChat(
        [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userContent  },
        ],
        maxOut
    );

    const refLines = loaded.map(s => `[${s.i + 1}] ${s.ref}${s.ok ? "" : ` (failed: ${s.error})`}`).join("\n");
    const text = `${content.trim()}\n\nSources:\n${refLines}`;

    return {
        text,
        structured: {
            answer:  content.trim(),
            search:  search_query ? { query: search_query, engine, search_type: type, urls: searched } : undefined,
            sources: loaded.map(s => ({
                index:     s.i + 1,
                ref:       s.ref,
                ok:        s.ok,
                kind:      s.kind,
                error:     s.ok ? undefined : s.error,
                chars:     s.ok ? s.content.length : undefined,
                truncated: s.ok ? blocks.find(b => b.i === s.i)?.truncated : undefined,
            })),
            usage,
            model: config.model,
        },
    };
}

// ── Tool registration ────────────────────────────────────────────────────────
export function registerDistillTool(server: Raw) {
    server.tool(
        "distill",
        "Read sources (URLs or absolute file paths) and answer a specific question using cx/gpt-5.4. Returns a concise answer with [n] citations. Optionally pass `search_query` to first search via 9router SearXNG (zero-cost, private) or Perplexity and distill top results. Use this instead of fetching/reading long content when you only need a specific answer.",
        {
            question: z.string().describe("Specific question to answer using the sources."),
            sources:  z.array(z.string()).optional()
                .describe("Optional explicit sources: URLs (http/https) or absolute file paths. Up to 10. Required if `search_query` is omitted."),
            search_query: z.string().optional()
                .describe("If provided, run a web search first and use the top URLs as sources (combined with any explicit `sources`)."),
            search_engine: z.enum(["searxng", "perplexity"]).optional().default("searxng")
                .describe("Search engine to use: 'searxng' (default, free & private metasearch) or 'perplexity'"),
            search_type: z.enum(["web", "news", "science", "it"]).optional().default("web")
                .describe("Search category when using searxng: 'web' (default), 'news', 'science', or 'it'"),
            search_max: z.number().int().min(1).max(8).optional()
                .describe("Max URLs to fetch from search_query. Default 5."),
            max_output_tokens: z.number().int().min(100).max(4000).optional()
                .describe("Cap on answer length in tokens. Default: 800."),
            language: z.enum(["vi", "en"]).optional()
                .describe("Answer language. Default: vi."),
        },
        async ({ question, sources, search_query, search_engine, search_type, search_max, max_output_tokens, language }: Raw) => {
            try {
                const r = await distill({ question, sources, search_query, search_engine, search_type, search_max, max_output_tokens, language });
                return { ...ok(r.text), structuredContent: r.structured };
            } catch (e) {
                return err(`distill failed: ${fmtErr(e)}`);
            }
        }
    );
}
