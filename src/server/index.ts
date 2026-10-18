import { execError } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { ok, err, fmtErr } from "../utils.ts";
import { streamChat } from "../distill/index.ts";
import { serverOps as config } from "../config.ts";

const execFileAsync = promisify(execFile);

// ── SSH helpers ──────────────────────────────────────────────────────────────
async function parseHosts(configPath: Raw) {
    let content;
    try {
        content = await readFile(configPath, "utf8");
    } catch (e) {
        throw new Error(`Cannot read SSH config at ${configPath}: ${fmtErr(e)}`);
    }
    const hosts: Raw = [];
    for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const m = line.match(/^Host\s+(.+)$/i);
        if (!m) continue;
        for (const h of m[1].split(/\s+/)) {
            if (!h || h.includes("*") || h.includes("?")) continue;
            if (config.fleetDenylist.includes(h)) continue;
            if (!hosts.includes(h)) hosts.push(h);
        }
    }
    return hosts;
}

async function runSsh(host: Raw, command: Raw, timeoutSec: Raw) {
    if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
        throw new Error(`Invalid host name: ${host}`);
    }
    const t = Math.min(Math.max(timeoutSec || config.timeoutDefault, 1), 30);
    try {
        const { stdout, stderr } = await execFileAsync(
            "ssh",
            [
                "-F", config.sshConfig,
                "-o", `ConnectTimeout=${t}`,
                "-o", "BatchMode=yes",
                "-o", "StrictHostKeyChecking=no",
                host,
                command,
            ],
            { timeout: (t + 5) * 1000, maxBuffer: config.maxRawBytes * 2 }
        );
        return { stdout: stdout || "", stderr: stderr || "", code: 0 };
    } catch (e) {
        // execFile throws on non-zero exit; surface output anyway
        const x = execError(e);
        if (x.killed && x.signal === "SIGTERM") {
            throw new Error(`SSH timeout to ${host} after ${t}s`);
        }
        return {
            stdout: x.stdout || "",
            stderr: x.stderr || fmtErr(e),
            code:   typeof x.code === "number" ? x.code : 1,
        };
    }
}

// ── Inspect ──────────────────────────────────────────────────────────────────
const INSPECT_SCRIPT = `\
set +e
mem=$(free 2>/dev/null | awk '/Mem:/ {if($2>0) printf "%d/%d", $3*100/$2, $2/1024}')
disk=$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5"/"$2}')
cpu1=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8,$5}' /proc/stat 2>/dev/null)
sleep 0.4
cpu2=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8,$5}' /proc/stat 2>/dev/null)
cpu=$(awk -v a="$cpu1" -v b="$cpu2" 'BEGIN{split(a,x);split(b,y);dt=y[1]-x[1];di=y[2]-x[2];if(dt>0)printf "%d",100*(dt-di)/dt;else print 0}')
load=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
upt=$(uptime -p 2>/dev/null | sed 's/^up //')
fail=$(systemctl list-units --state=failed --no-legend 2>/dev/null | wc -l | tr -d ' ')
fnames=$(systemctl list-units --state=failed --no-legend 2>/dev/null | awk '{print $1}' | head -3 | tr '\\n' ',' | sed 's/,$//')
upd=$(apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0)
printf "MEM=%s DISK=%s CPU=%s LOAD=%s UPT=%s FAIL=%s FNAMES=%s UPD=%s\\n" "$mem" "$disk" "$cpu" "$load" "$upt" "$fail" "$fnames" "$upd"
`;

function parseKv(line: Raw) {
    const out: Record<string, string> = {};
    // Split by space but keep value-after-= intact (UPT may contain spaces; we split first occurrence per token)
    // Our script uses single tokens for each KEY=VAL except UPT. Workaround: parse from regex.
    const re = /(\w+)=(\S*)/g;
    let m;
    while ((m = re.exec(line)) !== null) out[m[1]] = m[2];
    return out;
}

async function inspectOne(host: Raw, timeoutSec: Raw) {
    try {
        const { stdout, stderr, code } = await runSsh(host, INSPECT_SCRIPT, timeoutSec);
        if (code !== 0 && !stdout) {
            return { host, ok: false, error: (stderr || "ssh failed").split("\n")[0].slice(0, 200) };
        }
        const last = stdout.trim().split("\n").filter(Boolean).pop() || "";
        const kv   = parseKv(last);
        return {
            host,
            ok:     true,
            mem:    kv.MEM    || "-",
            disk:   kv.DISK   || "-",
            cpu:    kv.CPU    || "-",
            load:   kv.LOAD   || "-",
            uptime: kv.UPT    || "-",
            failed: parseInt(kv.FAIL || "0", 10) || 0,
            failed_units: kv.FNAMES || "",
            updates: parseInt(kv.UPD || "0", 10) || 0,
        };
    } catch (e) {
        return { host, ok: false, error: fmtErr(e).slice(0, 200) };
    }
}

async function inspectFleet(hosts: Raw, timeoutSec: Raw) {
    const results: Raw = [];
    let i = 0;
    async function worker() {
        while (i < hosts.length) {
            const idx = i++;
            results[idx] = await inspectOne(hosts[idx], timeoutSec);
        }
    }
    const workers = Array.from({ length: Math.min(config.fleetConcurrency, hosts.length) }, worker);
    await Promise.all(workers);
    return results;
}

function renderInspectTable(rows: Raw) {
    const head = "| host | state | mem%/MB | disk%/total | cpu% | load | failed | uptime |\n|---|---|---|---|---|---|---|---|";
    const body = rows.map((r: Raw) => {
        if (!r.ok) return `| ${r.host} | ❌ | - | - | - | - | - | ${r.error || "fail"} |`;
        const failCol = r.failed > 0 ? `⚠ ${r.failed}${r.failed_units ? ` (${r.failed_units})` : ""}` : "0";
        const state   = r.failed > 0 ? "⚠" : "✓";
        return `| ${r.host} | ${state} | ${r.mem} | ${r.disk} | ${r.cpu} | ${r.load} | ${failCol} | ${r.uptime} |`;
    }).join("\n");
    return `${head}\n${body}`;
}

// ── Logs ─────────────────────────────────────────────────────────────────────
function shellQuote(s: Raw) {
    return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function normalizeSince(s: Raw) {
    if (!s) return s;
    const m = String(s).trim().match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/i);
    if (!m) return s; // already a full string like "yesterday" or "2026-05-17 14:00:00"
    const n = m[1];
    const u = m[2].toLowerCase();
    if (u.startsWith("s"))      return `${n} seconds ago`;
    if (u.startsWith("min") || u === "m") return `${n} minutes ago`;
    if (u.startsWith("h"))      return `${n} hours ago`;
    if (u.startsWith("d"))      return `${n} days ago`;
    if (u.startsWith("w"))      return `${n} weeks ago`;
    return s;
}

async function getLogs({ host, service, lines, since, grep, errors_only, timeoutSec }: Raw) {
    if (!service || !/^[a-zA-Z0-9@._:-]+$/.test(service)) {
        throw new Error(`Invalid service name: ${service}`);
    }
    const n = Math.min(Math.max(lines || 200, 1), 1000);
    const sinceArg = since ? `--since ${shellQuote(normalizeSince(since))} ` : "";

    let cmd = `journalctl -u ${shellQuote(service)} ${sinceArg}-n ${n} --no-pager 2>&1`;
    if (errors_only) {
        cmd += ` | grep -iE 'error|warn|fail|exception|fatal|panic' || true`;
    } else if (grep) {
        cmd += ` | grep -E ${shellQuote(grep)} || true`;
    }
    // Cap output bytes
    cmd += ` | head -c ${config.maxRawBytes}`;

    const { stdout, stderr, code } = await runSsh(host, cmd, timeoutSec);
    if (code !== 0 && !stdout) {
        throw new Error(`SSH/journalctl failed on ${host}: ${(stderr || "").split("\n")[0]}`);
    }
    return {
        text: stdout || "(no log lines matched)",
        stderr,
        truncated: (stdout?.length || 0) >= config.maxRawBytes,
    };
}

// ── Distill helper ───────────────────────────────────────────────────────────
async function distillLogs({ raw, question, host, service, language }: Raw) {
    const sys = (language === "en")
        ? "You are a log analyst. Answer ONLY using the provided log lines. Be concise. Quote line excerpts when relevant."
        : "Bạn phân tích log. Trả lời CHỈ dựa trên các dòng log được cung cấp. Trả lời ngắn gọn, trích dẫn đoạn log khi cần.";
    const user = `Host: ${host}\nService: ${service}\nQuestion: ${question}\n\n--- LOGS ---\n${raw}`;
    const { content, usage } = await streamChat(
        [
            { role: "system", content: sys },
            { role: "user",   content: user },
        ],
        Math.min(Math.max(800, 200), 1500)
    );
    return { answer: content.trim(), usage };
}

// ── Tool registration ────────────────────────────────────────────────────────
export function registerServerTool(server: Raw) {
    server.tool(
        "server",
        "Server management over SSH for the home-server fleet. Modes: `inspect` (compact host stats — mem/disk/cpu/load/failed units) and `logs` (journalctl with server-side grep, optional cx/gpt-5.4 distill).",
        {
            mode: z.enum(["inspect", "logs"]).describe("`inspect`: host stats. `logs`: fetch service logs."),
            host: z.string().optional().describe("Hostname from .ssh/config. Required for `logs`. Optional for `inspect` (omit to scan whole fleet)."),
            service: z.string().optional().describe("Required for `logs` mode: systemd unit name (e.g. `9router`, `openclaw`)."),
            lines:   z.number().min(1).max(1000).optional().describe("Lines for journalctl. Default 200."),
            since:   z.string().optional().describe("journalctl --since value (e.g. `1h`, `24h`, `yesterday`). Default: 1h."),
            grep:    z.string().optional().describe("Regex filter applied server-side. Mutually exclusive with `errors_only`."),
            errors_only: z.boolean().optional().describe("Shortcut for grep `error|warn|fail|exception|fatal|panic`."),
            distill_question: z.string().optional().describe("If provided, distill log output via cx/gpt-5.4 and return the answer."),
            language: z.enum(["vi", "en"]).optional().describe("Distill answer language. Default vi."),
            timeout_sec: z.number().min(1).max(30).optional().describe("Per-SSH timeout. Default 10."),
        },
        async ({ mode, host, service, lines, since, grep, errors_only, distill_question, language, timeout_sec }: Raw) => {
            try {
                if (mode === "inspect") {
                    const hosts = host ? [host] : await parseHosts(config.sshConfig);
                    if (!hosts.length) throw new Error("No hosts found in SSH config (after denylist).");
                    const rows = await inspectFleet(hosts, timeout_sec);
                    const table = renderInspectTable(rows);
                    const failed = rows.filter((r: Raw) => !r.ok || r.failed > 0).length;
                    const summary = failed > 0
                        ? `\n\n${failed}/${rows.length} hosts have warnings or failed units.`
                        : `\n\nAll ${rows.length} hosts healthy.`;
                    return {
                        ...ok(`Fleet inspect (${rows.length} host${rows.length === 1 ? "" : "s"}):\n\n${table}${summary}`),
                        structuredContent: { mode, hosts: rows },
                    };
                }
                if (mode === "logs") {
                    if (!host || !service) throw new Error("`logs` mode requires both `host` and `service`.");
                    if (grep && errors_only) throw new Error("Use either `grep` OR `errors_only`, not both.");
                    const sinceVal = since || "1h";
                    const r = await getLogs({ host, service, lines, since: sinceVal, grep, errors_only, timeoutSec: timeout_sec });

                    if (distill_question) {
                        const d = await distillLogs({
                            raw: r.text,
                            question: distill_question,
                            host, service,
                            language: language || "vi",
                        });
                        return {
                            ...ok(`${d.answer}\n\n---\nLog source: ${host}:${service} (since=${sinceVal}, lines≤${lines || 200}${errors_only ? ", errors_only" : ""})${r.truncated ? " [truncated]" : ""}`),
                            structuredContent: {
                                mode, host, service,
                                answer: d.answer,
                                usage: d.usage,
                                raw_bytes: r.text.length,
                                truncated: r.truncated,
                            },
                        };
                    }
                    const header = `=== ${host}:${service} (since=${sinceVal}, lines≤${lines || 200}${errors_only ? ", errors_only" : ""})${r.truncated ? " [truncated]" : ""} ===\n`;
                    return {
                        ...ok(header + r.text),
                        structuredContent: { mode, host, service, raw_bytes: r.text.length, truncated: r.truncated },
                    };
                }
                throw new Error(`Unknown mode: ${mode}`);
            } catch (e) {
                return err(`ops failed: ${fmtErr(e)}`);
            }
        }
    );
}
