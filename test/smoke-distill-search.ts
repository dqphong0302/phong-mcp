import type { Raw } from "../src/academic/types.ts";
import { registerDistillTool } from "../src/distill/index.ts";
let handler: Raw;
const mockServer = { tool(name: Raw, desc: Raw, schema: Raw, fn: Raw) { handler = { name, desc, schema, fn }; } };
registerDistillTool(mockServer);

async function run(label: Raw, args: Raw) {
    process.stderr.write(`\n=== ${label} ===\n`);
    const t0 = Date.now();
    const r: Raw = await handler.fn(args);
    process.stderr.write(`time: ${Date.now() - t0} ms\n`);
    process.stderr.write(`isError: ${!!r.isError}\n`);
    process.stderr.write(`search: ${JSON.stringify(r.structuredContent?.search || null)}\n`);
    process.stderr.write(`usage: ${JSON.stringify(r.structuredContent?.usage || {})}\n`);
    process.stderr.write(`text:\n${(r.content?.[0]?.text || "").slice(0, 800)}\n`);
}

await run("search_query mode", {
    question: "Cuda 12.4 còn được hỗ trợ trên các GPU consumer Ampere (RTX 3060) không?",
    search_query: "CUDA 12.4 RTX 3060 Ampere support",
    search_max: 3,
    max_output_tokens: 300,
    language: "vi",
});
