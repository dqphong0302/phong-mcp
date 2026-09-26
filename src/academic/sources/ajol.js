/**
 * Africa's largest collection of peer-reviewed journals: ~500 titles from 30+
 * countries, most of them invisible to OpenAlex and Crossref.
 *
 * Same OJS 3 site-wide search endpoint as VJOL, so it reuses `_ojs.js`
 * verbatim: /index.php/index/search/search?query=...
 * Open Access, no API key.
 * Website: https://www.ajol.info/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "ajol";
export const name = "African Journals Online (AJOL — ~500 tạp chí châu Phi)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["africa", "open_access", "global_south", "medicine", "agriculture", "social_science"];

const SITE = {
  baseUrl: "https://www.ajol.info",
  sourceId: "ajol",
  publisher: "AJOL",
  defaultVenue: "African Journals Online (AJOL)",
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}
