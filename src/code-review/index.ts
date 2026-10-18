import { execError } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { ok, err, fmtErr } from "../utils.ts";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 60 * 1024; // 60KB cap

// ── Language detection ────────────────────────────────────────────────────────
const LANG_MAP: Record<string, string> = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".jsx": "react", ".tsx": "react-ts",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
};

function detectLang(filePath: Raw) {
  const ext = extname(filePath).toLowerCase();
  return LANG_MAP[ext] || null;
}

// ── Command runner ───────────────────────────────────────────────────────────
async function run(cmd: Raw, args: Raw, cwd: Raw, timeoutMs = 30000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT * 2,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    return { code: 0, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) };
  } catch (e) {
    const x = execError(e);
    return {
      code: x.code ?? 1,
      stdout: (x.stdout || "").slice(0, MAX_OUTPUT),
      stderr: (x.stderr || fmtErr(e)).slice(0, MAX_OUTPUT),
    };
  }
}

// ── Which tool is available ──────────────────────────────────────────────────
async function which(cmd: Raw) {
  try {
    const { stdout } = await execFileAsync("which", [cmd], { timeout: 3000 });
    return stdout.trim() || null;
  } catch { return null; }
}

// ── Lint runners ─────────────────────────────────────────────────────────────
async function lintJS(path: Raw, fix: Raw, cwd: Raw) {
  // Try biome first (faster), fallback to eslint
  const biome = await which("biome");
  if (biome) {
    const args = ["check", path];
    if (fix) args.push("--write");
    return run(biome, args, cwd);
  }
  const eslint = await which("eslint");
  if (eslint) {
    const args = [path, "--format", "stylish", "--no-color"];
    if (fix) args.push("--fix");
    return run(eslint, args, cwd);
  }
  // npx fallback
  const args = fix
    ? ["-y", "eslint", path, "--format", "stylish", "--no-color", "--fix"]
    : ["-y", "eslint", path, "--format", "stylish", "--no-color"];
  return run("npx", args, cwd, 60000);
}

async function lintPython(path: Raw, fix: Raw, cwd: Raw) {
  const ruff = await which("ruff");
  if (ruff) {
    if (fix) {
      await run(ruff, ["check", "--fix", path], cwd);
      return run(ruff, ["check", path, "--output-format", "text"], cwd);
    }
    return run(ruff, ["check", path, "--output-format", "text"], cwd);
  }
  return { code: -1, stdout: "", stderr: "ruff not found. Install: pip install ruff" };
}

async function lintGo(path: Raw, fix: Raw, cwd: Raw) {
  const golint = await which("golangci-lint");
  if (golint) {
    const args = ["run", "--out-format", "line-number"];
    if (fix) args.push("--fix");
    args.push(path);
    return run(golint, args, cwd);
  }
  return { code: -1, stdout: "", stderr: "golangci-lint not found." };
}

async function runLint(path: Raw, lang: Raw, fix: Raw, cwd: Raw) {
  switch (lang) {
    case "javascript": case "typescript": case "react": case "react-ts":
      return lintJS(path, fix, cwd);
    case "python":
      return lintPython(path, fix, cwd);
    case "go":
      return lintGo(path, fix, cwd);
    default:
      return { code: -1, stdout: "", stderr: `No linter configured for language: ${lang}` };
  }
}

// ── Security scan ────────────────────────────────────────────────────────────
const SECURITY_PATTERNS = [
  { pattern: /eval\s*\(/, issue: "eval() usage — potential code injection", severity: "high" },
  { pattern: /innerHTML\s*=/, issue: "innerHTML assignment — XSS risk", severity: "medium" },
  { pattern: /dangerouslySetInnerHTML/, issue: "dangerouslySetInnerHTML — XSS risk", severity: "medium" },
  { pattern: /exec\s*\(\s*[`"'].*\$\{/, issue: "Template literal in exec — command injection risk", severity: "high" },
  { pattern: /child_process.*exec\(/, issue: "exec() with string — prefer execFile()", severity: "medium" },
  { pattern: /password\s*[:=]\s*["'][^"']+["']/, issue: "Hardcoded password", severity: "high" },
  { pattern: /api[_-]?key\s*[:=]\s*["'][^"']+["']/, issue: "Hardcoded API key", severity: "high" },
  { pattern: /secret\s*[:=]\s*["'][^"']+["']/, issue: "Hardcoded secret", severity: "high" },
  { pattern: /SELECT\s+.*\+\s*['"$`]/, issue: "SQL string concatenation — injection risk", severity: "high" },
  { pattern: /Math\.random\(\)/, issue: "Math.random() for security — use crypto.randomBytes()", severity: "low" },
  { pattern: /disable.*ssl|verify\s*=\s*false|rejectUnauthorized.*false/, issue: "SSL verification disabled", severity: "high" },
  { pattern: /subprocess\.call\(.*shell\s*=\s*True/, issue: "subprocess with shell=True — injection risk", severity: "high" },
  { pattern: /os\.system\(/, issue: "os.system() — prefer subprocess with shell=False", severity: "medium" },
  { pattern: /pickle\.load/, issue: "pickle.load — deserialization vulnerability", severity: "medium" },
];

async function securityScan(path: Raw) {
  // Try semgrep first
  const semgrep = await which("semgrep");
  if (semgrep) {
    const result = await run(semgrep, ["scan", "--config", "auto", "--json", "--quiet", path], undefined, 60000);
    if (result.code === 0 || result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout);
        const findings = (parsed.results || []).map((r: Raw) => ({
          file: r.path,
          line: r.start?.line,
          rule: r.check_id,
          message: r.extra?.message || r.check_id,
          severity: r.extra?.severity || "warning",
        }));
        return { tool: "semgrep", findings, raw: null };
      } catch { /* fall through to regex */ }
    }
  }

  // Fallback: regex-based scan
  let content;
  const s = await stat(path);
  if (s.isDirectory()) {
    return { tool: "regex", findings: [], raw: "Directory scan requires semgrep. Install: pip install semgrep" };
  }
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    return { tool: "regex", findings: [], raw: `Cannot read file: ${fmtErr(e)}` };
  }

  const lines = content.split("\n");
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, issue, severity } of SECURITY_PATTERNS) {
      if (pattern.test(lines[i])) {
        findings.push({
          file: path,
          line: i + 1,
          rule: "regex-scan",
          message: issue,
          severity,
          snippet: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  return { tool: "regex", findings, raw: null };
}

// ── Diff mode ────────────────────────────────────────────────────────────────
async function getDiff(path: Raw, ref: Raw) {
  const gitDir = resolve(path);
  const args = ["diff", ref || "HEAD~1", "--", path];
  return run("git", args, gitDir);
}

// ── Format output ────────────────────────────────────────────────────────────
function formatLintResult(result: Raw, lang: Raw) {
  if (result.code === -1) return `⚠️ ${result.stderr}`;
  const output = (result.stdout || result.stderr || "").trim();
  if (!output && result.code === 0) return `✅ No lint issues found (${lang})`;
  return `### Lint (${lang})\n\`\`\`\n${output}\n\`\`\``;
}

function formatSecurityResult(scan: Raw) {
  if (scan.raw && !scan.findings.length) return `⚠️ ${scan.raw}`;
  if (!scan.findings.length) return `✅ No security issues found (${scan.tool})`;

  const grouped: Record<string, Raw[]> = { high: [], medium: [], low: [] };
  for (const f of scan.findings) {
    const sev = f.severity?.toLowerCase() || "medium";
    (grouped[sev] || grouped.medium).push(f);
  }

  let out = `### Security Scan (${scan.tool}) — ${scan.findings.length} issue(s)\n\n`;
  for (const [sev, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    const icon = sev === "high" ? "🔴" : sev === "medium" ? "🟡" : "🟢";
    out += `**${icon} ${sev.toUpperCase()}** (${items.length})\n`;
    for (const f of items) {
      out += `- L${f.line}: ${f.message}${f.snippet ? ` → \`${f.snippet}\`` : ""}\n`;
    }
    out += "\n";
  }
  return out.trim();
}

// ── Tool registration ────────────────────────────────────────────────────────
export function registerCodeReviewTool(server: Raw) {
  server.tool(
    "code_review",
    "Auto-review code: lint, security scan, complexity check. Runs locally on the workspace. Supports JS/TS (eslint/biome), Python (ruff), Go (golangci-lint), and regex-based security scanning (or semgrep if installed).",
    {
      path: z.string().describe("Absolute path to file or directory to review"),
      mode: z.enum(["full", "lint", "security", "diff"]).default("full")
        .describe("`full`: lint + security. `lint`: only lint. `security`: only security scan. `diff`: review git diff."),
      diff_ref: z.string().optional().describe("Git ref to diff against (e.g. HEAD~1, main). Used with mode=diff. Default: HEAD~1"),
      fix: z.boolean().optional().describe("Auto-fix lint issues where possible. Default: false"),
    },
    async ({ path: targetPath, mode, diff_ref, fix }: Raw) => {
      try {
        const absPath = resolve(targetPath);
        const s = await stat(absPath).catch(() => null);
        if (!s) return err(`Path not found: ${absPath}`);

        const lang = s.isFile() ? detectLang(absPath) : null;
        const cwd = s.isDirectory() ? absPath : resolve(absPath, "..");
        const sections = [];

        // Diff mode
        if (mode === "diff") {
          const diff = await getDiff(absPath, diff_ref);
          if (!diff.stdout?.trim()) {
            return ok("No changes found in diff.");
          }
          sections.push(`### Git Diff (${diff_ref || "HEAD~1"})\n\`\`\`diff\n${diff.stdout.trim()}\n\`\`\``);
          // Also lint the changed file
          if (lang) {
            const lint = await runLint(absPath, lang, false, cwd);
            sections.push(formatLintResult(lint, lang));
          }
          return ok(sections.join("\n\n"));
        }

        // Lint
        if (mode === "full" || mode === "lint") {
          if (s.isDirectory()) {
            // For directories, try common linters on the whole dir
            const jsLint = await lintJS(absPath, fix, cwd);
            if (jsLint.code !== -1) sections.push(formatLintResult(jsLint, "js/ts"));
            const pyLint = await lintPython(absPath, fix, cwd);
            if (pyLint.code !== -1) sections.push(formatLintResult(pyLint, "python"));
          } else if (lang) {
            const lint = await runLint(absPath, lang, fix, cwd);
            sections.push(formatLintResult(lint, lang));
          } else {
            sections.push(`⚠️ No linter for: ${basename(absPath)}`);
          }
        }

        // Security
        if (mode === "full" || mode === "security") {
          const scan = await securityScan(absPath);
          sections.push(formatSecurityResult(scan));
        }

        const output = sections.join("\n\n---\n\n");
        return {
          ...ok(output),
          structuredContent: { path: absPath, mode, lang, fix: !!fix },
        };
      } catch (e) {
        return err(`code_review failed: ${fmtErr(e)}`);
      }
    }
  );
}
