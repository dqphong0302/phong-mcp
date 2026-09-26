/**
 * Tạp chí Nghiên cứu Y học — Đại học Y Hà Nội. Một trong hai tạp chí y khoa
 * đầu ngành của Việt Nam.
 *
 * Domain này đã được `pdf-finder.js` nhận diện từ trước nhưng chưa từng có
 * plugin tìm kiếm — nghĩa là hệ thống biết cách lấy PDF của nó mà không có
 * cách nào tìm ra bài.
 *
 * Chạy OJS 3 nên dùng lại `_ojs.js` nguyên vẹn:
 * /index.php/index/search/search?query=...
 * Open Access, không cần API key.
 * Website: https://tapchinghiencuuyhoc.vn/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "tapchi_nghiencuuyhoc";
export const name = "Tạp chí Nghiên cứu Y học (ĐH Y Hà Nội)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["medicine", "clinical", "vietnam_medical", "public_health"];

const SITE = {
  baseUrl: "https://tapchinghiencuuyhoc.vn",
  sourceId: "tapchi_nghiencuuyhoc",
  publisher: "Trường Đại học Y Hà Nội",
  defaultVenue: "Tạp chí Nghiên cứu Y học (Journal of Medical Research)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
