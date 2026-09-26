/**
 * Sri Lanka Journals Online — the national OJS portal, same INASP platform as VJOL.
 *
 * Same OJS 3 site-wide search endpoint as VJOL, so it reuses `_ojs.js`
 * verbatim: /index.php/index/search/search?query=...
 * Open Access, no API key.
 * Website: https://sljol.info/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "sljol";
export const name = "SLJOL (Tạp chí khoa học Sri Lanka)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["asia", "open_access", "global_south", "medicine", "agriculture"];

const SITE = {
  baseUrl: "https://www.sljol.info",
  sourceId: "sljol",
  publisher: "SLJOL",
  defaultVenue: "Sri Lanka Journals Online (SLJOL)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
