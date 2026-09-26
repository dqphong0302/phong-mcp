/**
 * VNU Journal of Science — hệ tạp chí của Đại học Quốc gia Hà Nội, phủ khoa học
 * tự nhiên, kỹ thuật, kinh tế, luật, giáo dục và khoa học xã hội.
 *
 * Chạy OJS 3 theo từng chuyên san:
 * https://js.vnu.edu.vn/{SECTION}/search/search?query=...
 * Open Access, không cần API key.
 * Website: https://js.vnu.edu.vn/
 */

import { parseOjsSearch, withTimeout, getOjsById } from "./_ojs.js";

export const id = "vnu_js";
export const name = "VNU Journal of Science (ĐHQG Hà Nội)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["vietnam_academic", "vietnam_science", "vietnam_social", "science", "open_access"];

const SITE = {
  baseUrl: "https://js.vnu.edu.vn",
  sourceId: "vnu_js",
  publisher: "Đại học Quốc gia Hà Nội (VNU)",
  defaultVenue: "VNU Journal of Science",
  issn: null,
};

const SECTIONS = [
  { slug: "EES", name: "Earth and Environmental Studies" },
  { slug: "NST", name: "Natural Sciences and Technology" },
  { slug: "ER", name: "Education Research" },
  { slug: "EAB", name: "Economics and Business" },
  { slug: "JCSCE", name: "Computer Science and Communication Engineering" },
  { slug: "MPS", name: "Medical and Pharmaceutical Sciences" },
  { slug: "SSH", name: "Social Sciences and Humanities" },
  { slug: "MAP", name: "Mathematics - Physics" },
  { slug: "LS", name: "Legal Studies" },
  { slug: "PaM", name: "Policy and Management Studies" },
  { slug: "FS", name: "Foreign Studies" },
  { slug: "AMD", name: "Advanced Materials and Devices" },
];

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, year_min, year_max, signal } = opts;

  // Search across top sections in parallel
  const promises = SECTIONS.map(async (sec) => {
    try {
      const url = `${SITE.baseUrl}/${sec.slug}/search/search?query=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (academic-search-mcp/2.0)",
        },
        signal: withTimeout(signal, 15000),
      });
      if (!resp.ok) return { papers: [], total: 0 };
      const html = await resp.text();
      return parseOjsSearch(html, {
        ...SITE,
        baseUrl: `${SITE.baseUrl}/${sec.slug}`,
        defaultVenue: `VNU Journal of Science: ${sec.name}`,
        limit,
        yearMin: year_min,
        yearMax: year_max,
      });
    } catch {
      return { papers: [], total: 0 };
    }
  });

  const results = await Promise.all(promises);
  const seen = new Set();
  const allPapers = [];
  let totalCount = 0;

  for (const res of results) {
    totalCount += res.total || 0;
    for (const p of res.papers || []) {
      if (!seen.has(p.title.toLowerCase())) {
        seen.add(p.title.toLowerCase());
        allPapers.push(p);
      }
    }
  }

  return {
    papers: allPapers.slice(0, limit),
    total: totalCount || allPapers.length,
  };
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
