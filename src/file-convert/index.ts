import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { stat, readFile, writeFile } from "node:fs/promises";
import { basename, extname, dirname, join, resolve } from "node:path";
import { ok, err, fmtErr } from "../utils.ts";
import { fileConvert as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";
import { convertTable } from "../utils/table-converter.ts";

// ── Supported formats (mirrors backend registry) ─────────────────────────────
const SUPPORTED = {
  image: {
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".ico", ".svg", ".heic", ".heif", ".avif"],
    targets: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "ico", "pdf", "avif"],
  },
  video: {
    extensions: [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".ts", ".3gp"],
    targets: ["mp4", "mkv", "avi", "mov", "webm", "gif", "mp3", "wav", "flac", "ogg"],
  },
  audio: {
    extensions: [".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"],
    targets: ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus"],
  },
  document: {
    extensions: [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods", ".odp", ".rtf", ".csv"],
    targets: ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf", "csv", "txt", "html"],
  },
  text: {
    extensions: [".md", ".txt", ".html", ".htm", ".rst", ".tex", ".epub", ".adoc"],
    targets: ["pdf", "html", "docx", "epub", "txt", "md", "rst", "latex", "pptx"],
  },
};

function detectCategory(ext: Raw) {
  ext = ext.toLowerCase();
  for (const [cat, info] of Object.entries(SUPPORTED)) {
    if (info.extensions.includes(ext)) return { category: cat, ...info };
  }
  return null;
}

function getAllSupportedExtensions() {
  return Object.values(SUPPORTED).flatMap(c => c.extensions);
}

// ── Native data converters (JSON ↔ YAML ↔ CSV — no API needed) ──────────────
const DATA_EXTENSIONS = [".json", ".yaml", ".yml", ".csv"];
const DATA_TARGETS = ["json", "yaml", "yml", "csv"];

function isDataConversion(ext: Raw, target: Raw) {
  return DATA_EXTENSIONS.includes(ext.toLowerCase()) && DATA_TARGETS.includes(target.toLowerCase());
}

async function importYaml() {
  try {
    // Optional dependency, not in package.json: keep the specifier opaque to tsc.
    const specifier: string = "yaml";
    return await import(specifier);
  } catch { return null; }
}

async function convertDataNative(inputPath: Raw, targetFmt: Raw) {
  const content = await readFile(inputPath, "utf8");
  const ext = extname(inputPath).toLowerCase();
  let data;

  // Parse input
  if (ext === ".json") {
    data = JSON.parse(content);
  } else if (ext === ".yaml" || ext === ".yml") {
    const yamlMod = await importYaml();
    if (!yamlMod) return { error: "yaml package not available. Install: npm i yaml" };
    data = yamlMod.parse(content);
  } else if (ext === ".csv") {
    const lines = content.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    data = lines.slice(1).map(line => {
      const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, Raw> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return obj;
    });
  } else {
    return { error: `Cannot parse ${ext} natively` };
  }

  // Serialize output
  const target = targetFmt.toLowerCase().replace(".", "");
  if (target === "json") {
    return { content: JSON.stringify(data, null, 2) };
  } else if (target === "yaml" || target === "yml") {
    const yamlMod = await importYaml();
    if (!yamlMod) return { error: "yaml package not available. Install: npm i yaml" };
    return { content: yamlMod.stringify(data) };
  } else if (target === "csv") {
    if (!Array.isArray(data)) return { error: "Cannot convert non-array data to CSV" };
    const headers = Object.keys(data[0] || {});
    const rows = data.map(row => headers.map(h => `"${String(row[h] || "").replace(/"/g, '""')}"`).join(","));
    return { content: [headers.join(","), ...rows].join("\n") };
  }
  return { error: `Native conversion to ${target} not supported` };
}

// ── API call ─────────────────────────────────────────────────────────────────
async function callConvertAPI(inputPath: Raw, targetFmt: Raw) {
  const fileBuffer = await readFile(inputPath);
  const fileName = basename(inputPath);

  // Build multipart form data
  const boundary = `----FormBoundary${Date.now().toString(36)}`;
  const CRLF = "\r\n";

  // File part
  const fileHeader = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: application/octet-stream`,
    "",
  ].join(CRLF);

  // Target part
  const targetPart = [
    `${CRLF}--${boundary}`,
    `Content-Disposition: form-data; name="target"`,
    "",
    targetFmt,
  ].join(CRLF);

  const ending = `${CRLF}--${boundary}--${CRLF}`;

  // Combine parts
  const headerBuf = Buffer.from(fileHeader + CRLF, "utf8");
  const targetBuf = Buffer.from(targetPart, "utf8");
  const endBuf = Buffer.from(ending, "utf8");
  const body = Buffer.concat([headerBuf, fileBuffer, targetBuf, endBuf]);

  const url = `${config.baseUrl}/api/convert`;
  const headers: Record<string, string> = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  try {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body,
      timeout: config.timeoutMs,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { error: `API error ${response.status}: ${errText || response.statusText}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), contentType: response.headers.get("content-type") };
  } catch (e) {
    return { error: `API request failed: ${fmtErr(e)}` };
  }
}

// ── Formats listing from API ─────────────────────────────────────────────────
async function fetchFormats() {
  try {
    const res = await proxyAwareFetch(`${config.baseUrl}/api/formats`, { timeout: 5000 });
    if (res.ok) return (await res.json() as Raw);
  } catch { /* fallback to local registry */ }
  return null;
}

// ── Tool registration ────────────────────────────────────────────────────────
export function registerFileConvertTool(server: Raw) {
  server.tool(
    "file_convert",
    `Convert files between formats via remote API (${config.baseUrl}). Supports: images (png/jpg/webp/gif/heic/avif/svg/bmp/tiff→any), video (mp4/mkv/avi/mov/webm→any, extract audio), audio (mp3/wav/flac/ogg/aac/m4a/opus→any), documents (docx/xlsx/pptx/odt→pdf/html/txt), text/markup (md/html/rst/tex/epub→pdf/docx/html/epub). Also handles JSON↔YAML↔CSV natively.`,
    {
      input: z.string().describe("Absolute path to input file"),
      target: z.string().describe("Target format without dot (e.g. pdf, html, md, docx, mp3, png, yaml, json, webp, opus)"),
      output: z.string().optional().describe("Output path. Default: same directory, same name, new extension"),
    },
    async ({ input: inputPath, target, output: outputPath }: Raw) => {
      try {
        const absInput = resolve(inputPath);
        const s = await stat(absInput).catch(() => null);
        if (!s || !s.isFile()) return err(`Input file not found: ${absInput}`);

        const ext = extname(absInput).toLowerCase();
        const targetFmt = target.toLowerCase().replace(/^\./, "");

        // Determine output path
        const stem = basename(absInput, ext);
        const outDir = dirname(absInput);
        const finalOutput = outputPath ? resolve(outputPath) : join(outDir, `${stem}.${targetFmt}`);

        // ── Native data conversion (no API call needed) ──
        if (isDataConversion(ext, targetFmt)) {
          const result = await convertDataNative(absInput, targetFmt);
          if (result.error) return err(result.error);
          await writeFile(finalOutput, result.content, "utf8");
          const outStat = await stat(finalOutput);
          return ok(
            `✅ Converted: ${basename(absInput)} → ${basename(finalOutput)}\n` +
            `Method: native (JSON/YAML/CSV)\n` +
            `Output: ${finalOutput}\n` +
            `Size: ${(outStat.size / 1024).toFixed(1)} KB`
          );
        }

        // ── Validate format support ──
        const info = detectCategory(ext);
        if (!info) {
          return err(
            `Unsupported input format: ${ext}\n` +
            `Supported: ${getAllSupportedExtensions().join(", ")}`
          );
        }
        if (!info.targets.includes(targetFmt)) {
          return err(
            `Cannot convert ${ext} → .${targetFmt}\n` +
            `Supported targets for ${info.category}: ${info.targets.join(", ")}`
          );
        }

        // ── Call remote API ──
        const inputSize = s.size;
        const result = await callConvertAPI(absInput, targetFmt);

        if (result.error) return err(`Conversion failed: ${result.error}`);

        // Write output
        if (!result.data) return err("Conversion failed: converter returned no data");
        await writeFile(finalOutput, result.data);
        const outStat = await stat(finalOutput);

        const inKB = (inputSize / 1024).toFixed(1);
        const outKB = (outStat.size / 1024).toFixed(1);
        const sizeMB = outStat.size > 1024 * 1024 ? ` (${(outStat.size / 1024 / 1024).toFixed(2)} MB)` : "";

        return {
          ...ok(
            `✅ Converted: ${basename(absInput)} → ${basename(finalOutput)}\n` +
            `Method: API (${config.baseUrl})\n` +
            `Category: ${info.category}\n` +
            `Output: ${finalOutput}\n` +
            `Size: ${inKB} KB → ${outKB} KB${sizeMB}`
          ),
          structuredContent: {
            input: absInput,
            output: finalOutput,
            category: info.category,
            input_size: inputSize,
            output_size: outStat.size,
            api: config.baseUrl,
          },
        };
      } catch (e) {
        return err(`file_convert failed: ${fmtErr(e)}`);
      }
    }
  );

  // ── table_convert ──────────────────────────────────────────────────────────
  server.tool(
    "table_convert",
    "Zero-token deterministic table converter and formatter. " +
    "Converts between CSV, TSV, JSON, Markdown Table, and LaTeX Tabular without calling any LLM. " +
    "Pass raw table text (or JSON array) and target format ('markdown' | 'latex' | 'csv' | 'json').",
    {
      data: z.string().describe("Raw table content (CSV, TSV, Markdown table, or JSON array string)."),
      target: z.enum(["markdown", "latex", "csv", "json"]).default("markdown").describe("Target format ('markdown', 'latex', 'csv', 'json')."),
      caption: z.string().optional().describe("Optional caption/title (used for LaTeX table caption)."),
    },
    async ({ data, target, caption }: Raw) => {
      try {
        const res = convertTable(data, target, caption);
        return ok(res);
      } catch (e) {
        return err(`table_convert failed: ${fmtErr(e)}`);
      }
    }
  );
}
