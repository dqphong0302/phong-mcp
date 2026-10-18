import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { ok, err, fmtErr } from "../utils.ts";
import { perplexity as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

// ── Model constants ───────────────────────────────────────────────────────────
const MODEL_ASK      = "perplexity-pro";
const MODEL_RESEARCH = "perplexity-deep-research";
const MODEL_REASON   = "perplexity-reasoning";

const VERSION             = "0.9.0";

// ── Zod response schemas ──────────────────────────────────────────────────────
const ChatCompletionResponseSchema = z.object({
    choices: z.array(z.object({
        message: z.object({ content: z.string(), role: z.string().optional() }),
        finish_reason: z.string().optional(),
        index: z.number().optional(),
    })).min(1),
    citations: z.array(z.string()).optional(),
    usage: z.object({
        prompt_tokens:     z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens:      z.number().optional(),
    }).optional(),
    id:      z.string().optional(),
    model:   z.string().optional(),
    created: z.number().optional(),
});

const SearchResponseSchema = z.object({
    results: z.array(z.object({
        title:   z.string(),
        url:     z.string(),
        snippet: z.string().optional(),
        date:    z.string().optional(),
        score:   z.number().optional(),
    })),
    query: z.string().optional(),
    usage: z.object({ tokens: z.number().optional() }).optional(),
});

// ── Core API call ─────────────────────────────────────────────────────────────
async function makeApiRequest(endpoint: Raw, body: Raw, serviceOrigin: Raw) {
    if (!config.apiKey) {
        throw new Error("PERPLEXITY_API_KEY environment variable is required");
    }
    const url = `${config.baseUrl}/${endpoint}`;
    let response;
    try {
        response = await proxyAwareFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.apiKey}`,
                "User-Agent":    `perplexity-mcp/${VERSION}`,
                "X-Source":      "pplx-mcp-server",
                ...(serviceOrigin && { "X-Service": serviceOrigin }),
            },
            body: JSON.stringify(body),
            timeout: config.timeoutMs,
        });
    } catch (e) {
        throw new Error(`Network error while calling Perplexity API: ${fmtErr(e)}`);
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => "Unable to parse error response");
        throw new Error(`Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`);
    }
    return response;
}

// ── SSE stream consumer ───────────────────────────────────────────────────────
async function consumeSSEStream(response: Raw) {
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let contentParts = [], citations, usage, id, model, created, buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
                const parsed = JSON.parse(data);
                if (parsed.id)        id       = parsed.id;
                if (parsed.model)     model    = parsed.model;
                if (parsed.created)   created  = parsed.created;
                if (parsed.citations) citations = parsed.citations;
                if (parsed.usage)     usage    = parsed.usage;
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) contentParts.push(delta.content);
            } catch { /* skip malformed chunks */ }
        }
    }
    return ChatCompletionResponseSchema.parse({
        choices: [{ message: { content: contentParts.join("") }, finish_reason: "stop", index: 0 }],
        ...(citations && { citations }),
        ...(usage    && { usage }),
        ...(id       && { id }),
        ...(model    && { model }),
        ...(created  && { created }),
    });
}

// ── Chat completion ───────────────────────────────────────────────────────────
async function performChatCompletion(messages: Raw, model: Raw, stripThinking = false, serviceOrigin: Raw, options: Raw) {
    // Stream every chat model. Without SSE the Cloudflare Worker that fronts
    // ai-proxy.phongdang.io.vn closes long requests (>~60s) before Perplexity
    // finishes — common with reasoning_effort=high or large prompts.
    const useStreaming = true;
    const body = {
        model,
        messages,
        ...(useStreaming && { stream: true }),
        ...(options?.search_recency_filter && { search_recency_filter: options.search_recency_filter }),
        ...(options?.search_domain_filter  && { search_domain_filter:  options.search_domain_filter }),
        ...(options?.search_context_size   && { web_search_options: { search_context_size: options.search_context_size } }),
        ...(options?.reasoning_effort      && { reasoning_effort: options.reasoning_effort }),
    };
    const response = await makeApiRequest("chat/completions", body, serviceOrigin);
    let data;
    try {
        data = useStreaming
            ? await consumeSSEStream(response)
            : ChatCompletionResponseSchema.parse(await response.json());
    } catch (e) {
        if (e instanceof z.ZodError) {
            const issues = e.issues;
            if (issues.some(i => i.path.includes("message") || i.path.includes("content")))
                throw new Error("Invalid API response: missing message content");
            if (issues.some(i => i.path.includes("choices")))
                throw new Error("Invalid API response: missing or empty choices array");
        }
        throw new Error(`Failed to parse Perplexity API response: ${e}`);
    }

    let content = data.choices[0].message.content;
    if (stripThinking) content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (data.citations?.length) {
        content += "\n\nCitations:\n";
        data.citations.forEach((c, i) => { content += `[${i + 1}] ${c}\n`; });
    }
    return content;
}

// ── Search ────────────────────────────────────────────────────────────────────
// Note: The ai-proxy does not expose a /search route — search is implemented
// via chat/completions with the sonar model, which returns cited web results.
export async function performSearch(query: Raw, maxResults = 10, maxTokensPerPage = 1024, country: Raw, serviceOrigin: Raw) {
    const systemPrompt = [
        "You are a web search assistant. The user wants raw search results, not a synthesized answer.",
        `Return ONLY a JSON array of up to ${maxResults} results with this exact shape:`,
        `[{"title": "...", "url": "...", "snippet": "...", "date": "..."}]`,
        "Use the citations you find to populate the array. Output only valid JSON, nothing else.",
        ...(country ? [`Prioritize results from country: ${country}`] : []),
    ].join("\n");

    const body = {
        model: MODEL_ASK,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: `Search query: ${query}` },
        ],
        web_search_options: { search_context_size: "medium" },
    };

    const response = await makeApiRequest("chat/completions", body, serviceOrigin);
    const data     = ChatCompletionResponseSchema.parse(await response.json());
    const raw      = data.choices[0].message.content.trim();

    // Try to parse JSON results from the model response
    let results = [];
    try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) results = JSON.parse(jsonMatch[0]);
    } catch { /* fallback below */ }

    // Augment with citations from the response if available
    if (!results.length && data.citations?.length) {
        results = data.citations.slice(0, maxResults).map((url, i) => ({
            title: `Result ${i + 1}`,
            url,
            snippet: "",
            date: "",
        }));
    }

    if (!results.length) {
        // Final fallback: return the raw text response with citations
        let out = `Search results for: "${query}"\n\n${raw}`;
        if (data.citations?.length) {
            out += "\n\nCitations:\n";
            data.citations.forEach((c, i) => { out += `[${i + 1}] ${c}\n`; });
        }
        return out;
    }

    let out = `Found ${results.length} search results for: "${query}"\n\n`;
    results.forEach((r: Raw, i: Raw) => {
        out += `${i + 1}. **${r.title || "Untitled"}**\n   URL: ${r.url}\n`;
        if (r.snippet) out += `   ${r.snippet}\n`;
        if (r.date)    out += `   Date: ${r.date}\n`;
        out += "\n";
    });
    return out;
}

// Returns just an array of URL strings for a query. Used by distill+search flow.
export async function searchUrls(query: Raw, max = 5, serviceOrigin: Raw) {
    const systemPrompt = [
        "You are a web search assistant. Return ONLY a JSON array of up to",
        `${max} URLs that best answer the query. Format: ["https://...", "https://..."].`,
        "Output only valid JSON, no commentary.",
    ].join(" ");
    const body = {
        model: MODEL_ASK,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: `Query: ${query}` },
        ],
        web_search_options: { search_context_size: "medium" },
    };
    const response = await makeApiRequest("chat/completions", body, serviceOrigin);
    const data     = ChatCompletionResponseSchema.parse(await response.json());
    const raw      = data.choices[0].message.content.trim();
    let urls = [];
    try {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) urls = JSON.parse(m[0]).filter((u: Raw) => typeof u === "string" && /^https?:\/\//i.test(u));
    } catch { /* fall through */ }
    if (!urls.length && data.citations?.length) {
        urls = data.citations.filter(u => /^https?:\/\//i.test(u)).slice(0, max);
    }
    return urls.slice(0, max);
}


// ── Shared schema fields ──────────────────────────────────────────────────────
const messagesField = z.array(z.object({
    role:    z.enum(["system", "user", "assistant"]).describe("Role of the message sender"),
    content: z.string().describe("The content of the message"),
})).describe("Array of conversation messages");

const searchOptions = {
    search_recency_filter: z.enum(["hour", "day", "week", "month", "year"]).optional()
        .describe("Filter search results by recency (hour/day/week/month/year)."),
    search_domain_filter: z.array(z.string()).optional()
        .describe("Restrict to specific domains. Use '-' prefix to exclude (e.g. ['-reddit.com'])."),
    search_context_size: z.enum(["low", "medium", "high"]).optional()
        .describe("Web context depth. 'low' (default) is fastest, 'high' is most comprehensive."),
};

const stripThinkingField = z.boolean().optional()
    .describe("Remove <think>…</think> tokens from response to save context. Default: false.");

const reasoningEffortField = z.enum(["low", "medium", "high"]).optional()
    .describe("Depth of deep research reasoning. Default: 'medium'.");

// ── Tool registration ─────────────────────────────────────────────────────────
export function registerPerplexityTools(server: Raw, serviceOrigin?: string) {
    server.tool(
        "perplexity",
        "Unified Perplexity AI search and reasoning tool. " +
        "Modes: " +
        "- 'ask': Fast web-grounded Q&A (Sonar Pro). " +
        "- 'reason': Deep reasoning chain-of-thought (Sonar Reasoning Pro). " +
        "- 'research': Multi-source deep research (Sonar Deep Research). " +
        "- 'search': Raw search results (titles, URLs, snippets) without AI synthesis.",
        {
            query: z.string().optional().describe("Search query or question. Required if messages array is omitted."),
            messages: messagesField.optional(),
            mode: z.enum(["ask", "reason", "research", "search"]).optional().default("ask")
                .describe("Execution mode: ask (default), reason, research, or search"),
            // Search options
            search_recency_filter: searchOptions.search_recency_filter,
            search_domain_filter: searchOptions.search_domain_filter,
            search_context_size: searchOptions.search_context_size,
            // Reasoning/Research options
            strip_thinking: stripThinkingField,
            reasoning_effort: reasoningEffortField,
            // Raw search options
            max_results: z.number().min(1).max(20).optional().describe("Max search results (1-20, default: 10, mode='search' only)"),
            max_tokens_per_page: z.number().min(256).max(2048).optional().describe("Max tokens per webpage (mode='search' only)"),
            country: z.string().optional().describe("ISO 3166-1 alpha-2 country code for regional search (mode='search' only)"),
        },
        async ({
            query,
            messages,
            mode,
            search_recency_filter,
            search_domain_filter,
            search_context_size,
            strip_thinking,
            reasoning_effort,
            max_results,
            max_tokens_per_page,
            country
        }: Raw) => {
            try {
                const activeMode = mode || "ask";
                const searchOpts = { search_recency_filter, search_domain_filter, search_context_size };

                if (activeMode === "search") {
                    const searchQ = query || (messages && messages[messages.length - 1]?.content);
                    if (!searchQ) {
                        return err("Query or messages is required for mode='search'");
                    }
                    const result = await performSearch(
                        searchQ,
                        max_results ?? 10,
                        max_tokens_per_page ?? 1024,
                        country,
                        serviceOrigin
                    );
                    return { ...ok(result), structuredContent: { results: result } };
                }

                // Chat modes (ask, reason, research)
                let chatMessages = messages;
                if (!chatMessages) {
                    if (!query) {
                        return err("Either query or messages must be provided");
                    }
                    chatMessages = [{ role: "user", content: query }];
                }

                if (activeMode === "ask") {
                    const result = await performChatCompletion(chatMessages, MODEL_ASK, false, serviceOrigin, searchOpts);
                    return { ...ok(result), structuredContent: { response: result } };
                } else if (activeMode === "reason") {
                    const result = await performChatCompletion(chatMessages, MODEL_REASON, strip_thinking ?? false, serviceOrigin, searchOpts);
                    return { ...ok(result), structuredContent: { response: result } };
                } else if (activeMode === "research") {
                    const options = { reasoning_effort: reasoning_effort || "medium" };
                    const result = await performChatCompletion(chatMessages, MODEL_RESEARCH, strip_thinking ?? false, serviceOrigin, options);
                    return { ...ok(result), structuredContent: { response: result } };
                }

                return err(`Unsupported mode: ${activeMode}`);
            } catch (e) {
                return err(fmtErr(e));
            }
        }
    );
}
