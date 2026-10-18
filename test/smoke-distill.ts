// Smoke test: import distill module and run against a URL + a local file.
import type { Raw } from "../src/academic/types.ts";
import { registerDistillTool } from "../src/distill/index.ts";

// Minimal mock MCP server that captures the registered handler.
let handler: Raw;
const mockServer = {
    tool(name: Raw, desc: Raw, schema: Raw, fn: Raw) {
        handler = { name, desc, schema, fn };
    },
};

registerDistillTool(mockServer);

async function run(label: Raw, args: Raw) {
    process.stderr.write(`\n=== ${label} ===\n`);
    const t0 = Date.now();
    const result: Raw = await handler.fn(args);
    const ms = Date.now() - t0;
    const text = result.content?.[0]?.text || "(no text)";
    process.stderr.write(`time: ${ms} ms\n`);
    process.stderr.write(`isError: ${!!result.isError}\n`);
    process.stderr.write(`structured.usage: ${JSON.stringify(result.structuredContent?.usage || {})}\n`);
    process.stderr.write(`text (first 600 chars):\n${text.slice(0, 600)}\n`);
}

await run("URL test (example.com)", {
    question: "Tóm tắt nội dung chính trong 1 câu.",
    sources: ["https://example.com/"],
    max_output_tokens: 200,
    language: "vi",
});

await run("File test (package.json)", {
    question: "What dependencies are declared and what is the package main entry point?",
    sources: ["/Users/phongdang/home-server/services/ai-proxy/phong-mcp/package.json"],
    max_output_tokens: 200,
    language: "en",
});
