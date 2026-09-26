/**
 * Philippine Journals Online — the national OJS portal, same INASP platform
 * as VJOL. Strong in social science and education.
 *
 * Same OJS 3 site-wide search endpoint as VJOL, so it reuses `_ojs.js`
 * verbatim: /index.php/index/search/search?query=...
 * Open Access, no API key.
 * Website: https://philjol.info/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "philjol";
export const name = "PhilJOL (Tạp chí khoa học Philippines)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["asia", "open_access", "global_south", "social_science", "medicine"];

const SITE = {
  baseUrl: "https://www.philjol.info",
  sourceId: "philjol",
  publisher: "PhilJOL",
  defaultVenue: "Philippine Journals Online (PhilJOL)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
