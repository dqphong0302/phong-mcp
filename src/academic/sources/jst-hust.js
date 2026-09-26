/**
 * JST — Tạp chí Khoa học & Công nghệ các trường Đại học Kỹ thuật (jst.vn),
 * hosted by Đại học Bách Khoa Hà Nội (HUST). Engineering, smart systems,
 * data science & AI, sustainable development. Open Access, no API key.
 * Website: https://jst.vn/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "jst_hust";
export const name = "JST / HUST (Tạp chí KH&CN các trường ĐH Kỹ thuật — ĐH Bách Khoa Hà Nội)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = [
  "vietnam_academic", "vietnam_science", "vietnam_engineering", "cs_ai", "open_access",
];

const SITE = {
  baseUrl: "https://jst.vn",
  sourceId: "jst_hust",
  publisher: "Đại học Bách Khoa Hà Nội (HUST)",
  defaultVenue: "Tạp chí Khoa học & Công nghệ các trường Đại học Kỹ thuật (JST)",
  defaultSlug: "jst",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}

export { search as searchJstHust };
