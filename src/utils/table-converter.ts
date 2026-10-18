/**
 * Zero-Token Table Converter & Formatter
 * Converts between CSV, TSV, JSON, Markdown Table, and LaTeX Tabular without calling LLMs.
 */

import type { Raw } from "../academic/types.ts";
export function parseCsvOrTsv(rawText: Raw) {
  const lines = rawText.trim().split(/\r?\n/).filter((l: Raw) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = lines[0].includes("\t") ? "\t" : ",";

  const parseLine = (line: Raw) => {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

export function parseMarkdownTable(rawText: Raw) {
  const lines = rawText.trim().split(/\r?\n/).filter((l: Raw) => l.trim().startsWith("|") && l.trim().endsWith("|"));
  if (lines.length < 2) return null;

  const parseRow = (line: Raw) => line.slice(1, -1).split("|").map((c: Raw) => c.trim());
  const headers = parseRow(lines[0]);
  const dataLines = lines.slice(1).filter((l: Raw) => !/^\|\s*[-:]+[-| :]*\|$/.test(l.trim()));
  const rows = dataLines.map(parseRow);

  return { headers, rows };
}

export function parseJsonTable(data: Raw) {
  let parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!Array.isArray(parsed) || !parsed.length) return null;

  if (typeof parsed[0] === "object" && !Array.isArray(parsed[0])) {
    const headers = Object.keys(parsed[0]);
    const rows = parsed.map(obj => headers.map(k => String(obj[k] ?? "")));
    return { headers, rows };
  } else if (Array.isArray(parsed[0])) {
    const headers = parsed[0].map(String);
    const rows = parsed.slice(1).map(r => r.map(String));
    return { headers, rows };
  }
  return null;
}

export function toMarkdown(headers: Raw, rows: Raw) {
  if (!headers.length) return "";
  const colWidths = headers.map((h: Raw, i: Raw) => {
    const maxRowLen = rows.reduce((max: Raw, r: Raw) => Math.max(max, (r[i] || "").length), 0);
    return Math.max(h.length, maxRowLen, 3);
  });

  const pad = (str: Raw, len: Raw) => str + " ".repeat(Math.max(0, len - str.length));
  const headerLine = "| " + headers.map((h: Raw, i: Raw) => pad(h, colWidths[i])).join(" | ") + " |";
  const separatorLine = "| " + colWidths.map((w: Raw) => "-".repeat(w)).join(" | ") + " |";
  const rowLines = rows.map((r: Raw) => "| " + headers.map((_: Raw, i: Raw) => pad(r[i] || "", colWidths[i])).join(" | ") + " |");

  return [headerLine, separatorLine, ...rowLines].join("\n");
}

export function toLatex(headers: Raw, rows: Raw, caption = "") {
  if (!headers.length) return "";
  const align = "l".repeat(headers.length);
  const escapeLatex = (str: Raw) => String(str).replace(/([&%$#_{}~^\\])/g, "\\$1");

  const lines = [
    "\\begin{table}[htbp]",
    "  \\centering",
    caption ? `  \\caption{${escapeLatex(caption)}}` : null,
    `  \\begin{tabular}{${align}}`,
    "    \\toprule",
    "    " + headers.map(escapeLatex).join(" & ") + " \\\\",
    "    \\midrule",
    ...rows.map((r: Raw) => "    " + headers.map((_: Raw, i: Raw) => escapeLatex(r[i] || "")).join(" & ") + " \\\\"),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}",
  ].filter(Boolean);

  return lines.join("\n");
}

export function toCsv(headers: Raw, rows: Raw) {
  const escapeCsv = (val: Raw) => {
    const s = String(val ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headerLine = headers.map(escapeCsv).join(",");
  const rowLines = rows.map((r: Raw) => headers.map((_: Raw, i: Raw) => escapeCsv(r[i] || "")).join(","));
  return [headerLine, ...rowLines].join("\n");
}

export function convertTable(data: Raw, targetFormat = "markdown", caption = "") {
  let parsed = null;
  const raw = String(data || "").trim();

  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { parsed = parseJsonTable(raw); } catch {}
  }
  if (!parsed && raw.startsWith("|")) {
    parsed = parseMarkdownTable(raw);
  }
  if (!parsed) {
    parsed = parseCsvOrTsv(raw);
  }

  if (!parsed || !parsed.headers.length) {
    throw new Error("Unable to parse input data as a valid table structure");
  }

  const { headers, rows } = parsed;
  switch (targetFormat.toLowerCase()) {
    case "markdown":
    case "md":
      return toMarkdown(headers, rows);
    case "latex":
    case "tex":
      return toLatex(headers, rows, caption);
    case "csv":
      return toCsv(headers, rows);
    case "json":
      return JSON.stringify(rows.map((r: Raw) => Object.fromEntries(headers.map((h: Raw, i: Raw) => [h, r[i] || ""]))), null, 2);
    default:
      return toMarkdown(headers, rows);
  }
}
