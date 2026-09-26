/**
 * Academic Table Extractor & Parser.
 * Converts HTML <table> elements or Markdown tables from papers/scraped content
 * into Clean CSV, JSON Arrays, and Pandas-ready data structures.
 */

/**
 * Clean text within table cell.
 * @param {string} raw
 * @returns {string}
 */
function cleanCell(raw) {
  return (raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escape field for CSV.
 * @param {string} val
 * @returns {string}
 */
function escapeCsv(val) {
  const str = String(val || "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Extract tables from HTML or Markdown content.
 *
 * @param {string} content HTML or Markdown string
 * @param {Object} [opts]
 * @param {number} [opts.max_tables=10] Max tables to extract
 * @returns {Array<{ table_index: number, caption: string, headers: Array<string>, rows: Array<Array<string>>, csv: string, json: Array<Object> }>}
 */
export function extractTables(content, opts = {}) {
  const maxTables = opts.max_tables || 10;
  const tables = [];

  if (!content || typeof content !== "string") return [];

  // 1. Try HTML <table> parsing via regex
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match;
  let idx = 1;

  while ((match = tableRegex.exec(content)) !== null && tables.length < maxTables) {
    const tableHtml = match[1];

    // Extract caption if present
    const captionMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
    const caption = captionMatch ? cleanCell(captionMatch[1]) : `Table ${idx}`;

    // Extract rows <tr>
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    const allRows = [];

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cellMatch;
      const rowCells = [];
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        rowCells.push(cleanCell(cellMatch[1]));
      }
      if (rowCells.length > 0) {
        allRows.push(rowCells);
      }
    }

    if (allRows.length > 0) {
      const headers = allRows[0];
      const dataRows = allRows.slice(1);

      // Build CSV
      const csvLines = [headers.map(escapeCsv).join(",")];
      for (const r of dataRows) {
        csvLines.push(r.map(escapeCsv).join(","));
      }
      const csv = csvLines.join("\n");

      // Build JSON Array of Objects
      const json = dataRows.map((r) => {
        const obj = {};
        headers.forEach((h, hIdx) => {
          const key = h || `col_${hIdx + 1}`;
          obj[key] = r[hIdx] !== undefined ? r[hIdx] : null;
        });
        return obj;
      });

      tables.push({
        table_index: idx++,
        caption,
        headers,
        rows: dataRows,
        csv,
        json,
      });
    }
  }

  // 2. Fallback: Parse Markdown tables if no HTML tables found
  if (tables.length === 0 && content.includes("|")) {
    const lines = content.split("\n");
    let currentTableRows = [];
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        // Skip markdown separator row |---|---|
        if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) {
          continue;
        }
        const cells = trimmed
          .slice(1, -1)
          .split("|")
          .map((c) => cleanCell(c));
        currentTableRows.push(cells);
        inTable = true;
      } else if (inTable) {
        if (currentTableRows.length > 1) {
          const headers = currentTableRows[0];
          const dataRows = currentTableRows.slice(1);
          const csvLines = [headers.map(escapeCsv).join(",")];
          for (const r of dataRows) csvLines.push(r.map(escapeCsv).join(","));
          const csv = csvLines.join("\n");

          const json = dataRows.map((r) => {
            const obj = {};
            headers.forEach((h, hIdx) => {
              obj[h || `col_${hIdx + 1}`] = r[hIdx] || null;
            });
            return obj;
          });

          tables.push({
            table_index: idx++,
            caption: `Markdown Table ${idx - 1}`,
            headers,
            rows: dataRows,
            csv,
            json,
          });
        }
        currentTableRows = [];
        inTable = false;
      }
    }

    if (currentTableRows.length > 1) {
      const headers = currentTableRows[0];
      const dataRows = currentTableRows.slice(1);
      const csvLines = [headers.map(escapeCsv).join(",")];
      for (const r of dataRows) csvLines.push(r.map(escapeCsv).join(","));
      const csv = csvLines.join("\n");

      const json = dataRows.map((r) => {
        const obj = {};
        headers.forEach((h, hIdx) => {
          obj[h || `col_${hIdx + 1}`] = r[hIdx] || null;
        });
        return obj;
      });

      tables.push({
        table_index: idx++,
        caption: `Markdown Table ${idx - 1}`,
        headers,
        rows: dataRows,
        csv,
        json,
      });
    }
  }

  return tables;
}
