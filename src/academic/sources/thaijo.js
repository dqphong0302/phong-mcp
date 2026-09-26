/**
 * Thai Journals Online — the national OJS portal run by the Thai-Journal
 * Citation Index Centre; ~800 Thai journals.
 *
 * Same OJS 3 site-wide search endpoint as VJOL, so it reuses `_ojs.js`
 * verbatim: /index.php/index/search/search?query=...
 * Open Access, no API key.
 * LƯU Ý: ThaiJO không có một index OJS chung cho toàn bộ cổng — các tạp chí
 * nằm rải trên các cụm so01..so09.tci-thaijo.org, mỗi cụm là một cài đặt OJS
 * riêng. Nguồn này trỏ vào so01 (cụm lớn nhất); muốn phủ hết phải thêm từng
 * cụm thành từng nguồn.
 * Website: https://so01.tci-thaijo.org/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "thaijo";
export const name = "ThaiJO / TCI (Tạp chí khoa học Thái Lan)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["asia", "open_access", "global_south", "medicine", "engineering", "social_science"];

const SITE = {
  baseUrl: "https://so01.tci-thaijo.org",
  sourceId: "thaijo",
  publisher: "Thai-Journal Citation Index Centre (TCI)",
  defaultVenue: "Thai Journals Online (ThaiJO / TCI)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
