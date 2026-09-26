/**
 * Vietnam Journals Online (VJOL — Cổng Thông tin Tạp chí Khoa học Việt Nam Trực tuyến).
 * Managed by Cục Thông tin KH&CN Quốc gia (NASATI — Bộ Khoa học và Công nghệ).
 * Aggregates 130+ peer-reviewed Vietnamese journals. Open Access, no API key.
 * Website: https://vjol.info.vn/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "vjol";
export const name = "Vietnam Journals Online (VJOL — 130+ Tạp chí KH Việt Nam)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = [
  "vietnam_academic", "vietnam_science", "vietnam_medical",
  "vietnam_social", "vietnam_engineering", "agriculture", "open_access",
];

const SITE = {
  baseUrl: "https://vjol.info.vn",
  sourceId: "vjol",
  publisher: "Cục Thông tin KH&CN Quốc gia (NASATI) / VJOL",
  defaultVenue: "Vietnam Journals Online (VJOL)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}

export { search as searchVjol };
