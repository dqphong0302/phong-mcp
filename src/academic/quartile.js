/**
 * Journal Quartile Engine (SCImago Journal Rank — SJR)
 * Provides instant O(1) lookup of journal quartile (Q1, Q2, Q3, Q4),
 * SJR impact score, and H-index based on ISSN and journal title.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

function loadDatabase() {
  if (db) return db;
  try {
    const dbPath = path.join(__dirname, "../../data/scimagojr.json");
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, "utf-8");
      db = JSON.parse(raw);
    } else {
      // Fallback relative to server if bundled
      const altPath = path.join(__dirname, "../data/scimagojr.json");
      if (fs.existsSync(altPath)) {
        db = JSON.parse(fs.readFileSync(altPath, "utf-8"));
      }
    }
  } catch (err) {
    console.error("[QuartileEngine] Failed to load scimagojr.json:", err.message);
  }
  return db;
}

// Well-known journal abbreviations mapping for robust resolution
const COMMON_ABBREVIATIONS = {
  "nejm": "new england journal of medicine",
  "n engl j med": "new england journal of medicine",
  "jama": "jama journal of the american medical association",
  "bmj": "bmj",
  "lancet": "the lancet",
  "nat med": "nature medicine",
  "nat biotechnol": "nature biotechnology",
  "nat genet": "nature genetics",
  "nat commun": "nature communications",
  "pnas": "proceedings of the national academy of sciences of the united states of america",
  "ieee tpami": "ieee transactions on pattern analysis and machine intelligence",
  "tpami": "ieee transactions on pattern analysis and machine intelligence",
  "ann intern med": "annals of internal medicine",
  "circ": "circulation",
  "j clin oncol": "journal of clinical oncology",
  "eur heart j": "european heart journal",
};

export function cleanIssn(issn) {
  if (!issn) return null;
  const clean = String(issn).replace(/[^0-9X]/gi, "").toUpperCase();
  return clean.length === 8 ? clean : null;
}

export function cleanTitle(title) {
  if (!title) return "";
  let t = String(title)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (COMMON_ABBREVIATIONS[t]) {
    t = COMMON_ABBREVIATIONS[t].replace(/[^\w\s]/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  }
  return t;
}

/**
 * Get quartile information for a given ISSN or Journal Title.
 * @param {Object} params
 * @param {string|string[]} [params.issn] - ISSN or array of ISSNs
 * @param {string} [params.venue] - Journal or venue title
 * @returns {{ quartile: "Q1"|"Q2"|"Q3"|"Q4"|null, sjr: number|null, hIndex: number|null, journal: string|null }}
 */
export function getJournalQuartile({ issn, venue }) {
  const data = loadDatabase();
  if (!data) return { quartile: null, sjr: null, hIndex: null, journal: null };

  // 1. Try ISSN match (highest confidence)
  if (issn) {
    const issnList = Array.isArray(issn) ? issn : [issn];
    for (const raw of issnList) {
      const c = cleanIssn(raw);
      if (c && data.byIssn[c]) {
        const item = data.byIssn[c];
        return {
          quartile: item.q,
          sjr: item.sjr,
          hIndex: item.h,
          journal: item.title,
        };
      }
    }
  }

  // 2. Try Exact Title match
  if (venue) {
    const norm = cleanTitle(venue);
    if (norm && data.byTitle[norm]) {
      const item = data.byTitle[norm];
      return {
        quartile: item.q,
        sjr: item.sjr,
        hIndex: item.h,
        journal: item.title,
      };
    }

    // 3. Try Partial/Fuzzy Title prefix match for common variants
    if (norm.length > 5) {
      // Check if title is prefix or contained
      for (const [tKey, item] of Object.entries(data.byTitle)) {
        if (tKey === norm || (norm.length > 10 && tKey.startsWith(norm)) || (tKey.length > 10 && norm.startsWith(tKey))) {
          return {
            quartile: item.q,
            sjr: item.sjr,
            hIndex: item.h,
            journal: item.title,
          };
        }
      }
    }
  }

  return { quartile: null, sjr: null, hIndex: null, journal: null };
}

/**
 * Check if a paper matches the minimum quartile requirement
 * @param {string|null} paperQuartile - "Q1", "Q2", "Q3", "Q4"
 * @param {string} minQuartile - "Q1", "Q2", "Q3", "Q4"
 * @returns {boolean}
 */
export function satisfiesMinQuartile(paperQuartile, minQuartile) {
  if (!minQuartile || minQuartile === "all") return true;
  if (!paperQuartile) return false;

  const ranks = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
  const paperRank = ranks[paperQuartile.toUpperCase()] || 0;
  const minRank = ranks[minQuartile.toUpperCase()] || 0;

  return paperRank >= minRank;
}
