/**
 * Journal Rank & Metrics Engine (Zero-Token Scimago SJR & Quartile Lookup)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanIssn, cleanTitle } from "./quartile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

function loadDatabase() {
  if (db) return db;
  try {
    const dbPath = path.join(__dirname, "../../data/scimagojr.json");
    if (fs.existsSync(dbPath)) {
      db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    } else {
      const altPath = path.join(__dirname, "../data/scimagojr.json");
      if (fs.existsSync(altPath)) {
        db = JSON.parse(fs.readFileSync(altPath, "utf-8"));
      }
    }
  } catch (err) {
    console.error("[JournalRank] Failed to load scimagojr.json:", err.message);
  }
  return db;
}

export function lookupJournalRank(query, limit = 5) {
  const data = loadDatabase();
  if (!data) return { query, count: 0, results: [], error: "Scimago database not loaded" };

  const q = String(query || "").trim();
  if (!q) return { query, count: 0, results: [] };

  // 1. ISSN check
  const cIssn = cleanIssn(q);
  if (cIssn && data.byIssn && data.byIssn[cIssn]) {
    const item = data.byIssn[cIssn];
    return {
      query,
      count: 1,
      results: [{
        title: item.title,
        quartile: item.q || "Unknown",
        sjr: item.sjr || null,
        h_index: item.h || null,
        matched_by: "issn",
      }],
    };
  }

  // 2. Title matching
  const norm = cleanTitle(q);
  const results = [];
  const seen = new Set();

  if (norm && data.byTitle) {
    if (data.byTitle[norm]) {
      const exact = data.byTitle[norm];
      results.push({
        title: exact.title,
        quartile: exact.q || "Unknown",
        sjr: exact.sjr || null,
        h_index: exact.h || null,
        matched_by: "exact_title",
      });
      seen.add(exact.title.toLowerCase());
    }

    // Partial / Substring search
    for (const [tKey, item] of Object.entries(data.byTitle)) {
      if (results.length >= limit) break;
      if (seen.has(item.title.toLowerCase())) continue;

      if (tKey.includes(norm) || (norm.length > 5 && norm.includes(tKey))) {
        results.push({
          title: item.title,
          quartile: item.q || "Unknown",
          sjr: item.sjr || null,
          h_index: item.h || null,
          matched_by: "fuzzy_title",
        });
        seen.add(item.title.toLowerCase());
      }
    }
  }

  return {
    query,
    count: results.length,
    results,
  };
}
