import { errorMessage } from "../src/academic/errors.ts";
import type { Raw } from "../src/academic/types.ts";
import { registerServerTool } from "../src/server/index.ts";

let handler: Raw;
const mockServer = { tool(name: Raw, desc: Raw, schema: Raw, fn: Raw) { handler = { name, desc, schema, fn }; } };
registerServerTool(mockServer);

async function run(label: Raw, args: Raw) {
    process.stderr.write(`\n=== ${label} ===\n`);
    const t0 = Date.now();
    try {
        const r: Raw = await handler.fn(args);
        process.stderr.write(`time: ${Date.now() - t0} ms | isError: ${!!r.isError}\n`);
        const text = r.content?.[0]?.text || "";
        process.stderr.write(`text:\n${text.slice(0, 1200)}\n`);
        if (r.structuredContent) {
            const sc = JSON.parse(JSON.stringify(r.structuredContent));
            if (sc.hosts) sc.hosts = sc.hosts.map((h: Raw) => ({ host: h.host, ok: h.ok, mem: h.mem, disk: h.disk, cpu: h.cpu, failed: h.failed }));
            process.stderr.write(`structured: ${JSON.stringify(sc).slice(0, 600)}\n`);
        }
    } catch (e) {
        process.stderr.write(`THREW: ${errorMessage(e)}\n`);
    }
}

const arg = process.argv[2] || "all";

if (arg === "all" || arg === "inspect-one") {
    await run("inspect host=n8n", { mode: "inspect", host: "n8n", timeout_sec: 8 });
}
if (arg === "all" || arg === "inspect-fleet") {
    await run("inspect fleet", { mode: "inspect", timeout_sec: 8 });
}
if (arg === "all" || arg === "logs-errors") {
    await run("logs errors_only", {
        mode: "logs",
        host: "9router",
        service: "9router",
        lines: 100,
        since: "2h",
        errors_only: true,
        timeout_sec: 10,
    });
}
if (arg === "all" || arg === "logs-distill") {
    await run("logs + distill", {
        mode: "logs",
        host: "openclaw",
        service: "harness-agent",
        lines: 200,
        since: "2h",
        distill_question: "Có lỗi nghiêm trọng nào trong log gần đây không? Tóm tắt nguyên nhân nếu có.",
        language: "vi",
        timeout_sec: 12,
    });
}
if (arg === "bad") {
    await run("bad host", { mode: "logs", host: "doesnotexist", service: "x" });
}
