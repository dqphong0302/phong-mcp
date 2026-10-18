import { errorMessage } from "../src/academic/errors.ts";
import type { Raw } from "../src/academic/types.ts";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Resolve paths ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpJsonPath = path.resolve(__dirname, "../../../../.mcp.json");

// ── Load Environment Variables from .mcp.json ──────────────────────────────
async function loadEnv() {
    try {
        console.log(`[test-runner] Reading environment keys from: ${mcpJsonPath}`);
        const mcpJsonRaw = await fs.readFile(mcpJsonPath, "utf-8");
        const mcpConfig = JSON.parse(mcpJsonRaw);
        const phongMcpEnv = mcpConfig.mcpServers["phong-mcp"]?.env || {};
        
        for (const [key, value] of Object.entries(phongMcpEnv)) {
            const strValue = String(value);
            process.env[key] = strValue;
            // Mask API keys in logs for security
            const displayVal = strValue.length > 15 ? strValue.slice(0, 8) + "..." + strValue.slice(-4) : strValue;
            console.log(`  Set: ${key} = ${displayVal}`);
        }
    } catch (e) {
        console.error(`[test-runner] Failed to load .mcp.json config:`, e);
        process.exit(1);
    }
}

// 1. Load env vars first!
await loadEnv();

// 2. Now dynamically import the modules after environment variables are set!
const { registerPerplexityTools } = await import("../src/perplexity/index.ts");
const { registerConsensusTools } = await import("../src/consensus/index.ts");
const { registerTtsTools } = await import("../src/tts/index.ts");
const { registerDistillTool } = await import("../src/distill/index.ts");
const { registerServerTool } = await import("../src/server/index.ts");
const { registerCodeReviewTool } = await import("../src/code-review/index.ts");
const { registerFileConvertTool } = await import("../src/file-convert/index.ts");
const { registerContentGenTool } = await import("../src/content-gen/index.ts");
const { registerFetchTool, registerAuthFetchTool } = await import("../src/fetch/index.ts");
const { registerDiagramTools } = await import("../src/diagram/index.ts");
const { registerMedicalTools } = await import("../src/medical/index.ts");

const toolRegistry: Record<string, Raw> = {};
const mockServer = {
    tool(name: Raw, desc: Raw, schema: Raw, fn: Raw) {
        toolRegistry[name] = { name, desc, schema, fn };
    }
};

// Register all tools onto our mock registry
registerPerplexityTools(mockServer, "test-suite");
registerConsensusTools(mockServer);
registerTtsTools(mockServer);
registerDistillTool(mockServer);
registerServerTool(mockServer);
registerCodeReviewTool(mockServer);
registerFileConvertTool(mockServer);
registerContentGenTool(mockServer);
registerFetchTool(mockServer);
registerAuthFetchTool(mockServer);
registerDiagramTools(mockServer);
registerMedicalTools(mockServer);

console.log(`\n[test-runner] Registered ${Object.keys(toolRegistry).length} tools in test registry.`);

// ── Run Tests ────────────────────────────────────────────────────────────────
const results: Raw = [];

async function runTest(toolName: Raw, args: Raw) {
    const tool = toolRegistry[toolName];
    if (!tool) {
        console.error(`[test-runner] FAIL: Tool ${toolName} not found in registry.`);
        results.push({ name: toolName, status: "MISSING", error: "Not registered" });
        return;
    }

    console.log(`\n================================================================`);
    console.log(`[TEST] Calling Tool: ${toolName}`);
    console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);
    console.log(`================================================================`);
    
    const t0 = Date.now();
    try {
        const response = await tool.fn(args);
        const duration = Date.now() - t0;
        
        const isError = !!response.isError;
        const text = response.content?.[0]?.text || "";
        
        console.log(`[RESULT] Time: ${duration}ms | isError: ${isError}`);
        if (text) {
            console.log(`Output (first 800 chars):\n${text.slice(0, 800)}\n${text.length > 800 ? "... (truncated)" : ""}`);
        } else {
            console.log(`Structured Content: ${JSON.stringify(response.structuredContent || {})}`);
        }
        
        if (isError) {
            results.push({ name: toolName, status: "FAILED", duration, error: text || "API returned error" });
        } else {
            results.push({ name: toolName, status: "PASSED", duration });
        }
    } catch (e) {
        const duration = Date.now() - t0;
        console.error(`[THREW] Error calling ${toolName}:`, e);
        results.push({ name: toolName, status: "THREW", duration, error: errorMessage(e) });
    }
}

// 1. Perplexity Test
await runTest("perplexity_ask", {
    messages: [
        { role: "user", content: "Ai là người đầu tiên đặt chân lên mặt trăng?" }
    ]
});

// 2. Perplexity Search Test
await runTest("perplexity_search", {
    query: "Antigravity IDE Google DeepMind",
    max_results: 3
});

// 3. Consensus Academic Search Test
await runTest("consensus_search_papers", {
    query: "metformin longevity clinical trials",
    limit: 3
});

// 4. Diagram Render Test (Uses Kroki.io - no key required)
await runTest("diagram_render", {
    type: "mermaid",
    source: `graph LR\n  A[Client] --> B(Gateway)\n  B --> C[phong-mcp]`
});

// 5. Content Generation Test
await runTest("content_generator", {
    prompt: "Viết một lời chào ngắn bằng tiếng Việt thân thiện gửi đến người dùng Antigravity IDE."
});

// 6. Speech Synthesis Test (Optional, depending on local cluster availability)
await runTest("tts_generate_audio", {
    text: "Xin chào bạn, tôi là hệ thống thử nghiệm phong mờ cờ pê.",
    voice: "ngochuyen"
});

// ── Summary Report ──────────────────────────────────────────────────────────
console.log(`\n\n================================================================`);
console.log(`                       TEST SUITE REPORT                        `);
console.log(`================================================================`);
let passedCount = 0;
for (const res of results) {
    const statusSymbol = res.status === "PASSED" ? "✅" : "❌";
    console.log(`${statusSymbol} [${res.status}] ${res.name.padEnd(30)} (${res.duration}ms)${res.error ? ` - Error: ${res.error.slice(0, 100)}` : ""}`);
    if (res.status === "PASSED") passedCount++;
}
console.log(`================================================================`);
console.log(`Summary: ${passedCount}/${results.length} tests passed.`);
console.log(`================================================================\n`);
