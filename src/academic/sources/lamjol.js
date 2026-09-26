/**
 * Latin America Journals Online — Central American journals on the same INASP
 * OJS platform as VJOL. Partially fills the SciELO gap, which has no REST
 * search API.
 *
 * Same OJS 3 site-wide search endpoint as VJOL, so it reuses `_ojs.js`
 * verbatim: /index.php/index/search/search?query=...
 * Open Access, no API key.
 * Website: https://www.lamjol.info/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "lamjol";
export const name = "LAMJOL (Tạp chí khoa học Trung Mỹ)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["latin_america", "open_access", "global_south", "medicine", "social_science"];

const SITE = {
  baseUrl: "https://www.lamjol.info",
  sourceId: "lamjol",
  publisher: "LAMJOL",
  defaultVenue: "Latin America Journals Online (LAMJOL)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
