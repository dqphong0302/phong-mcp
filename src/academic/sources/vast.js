/**
 * Vietnam Academy of Science and Technology (VAST — Viện Hàn lâm KH&CN Việt Nam).
 * Multi-journal OJS portal (VJST, VJM, VJC, Communications in Physics, ...).
 * Several titles are indexed in Scopus / WoS ESCI / ACI. Open Access, no API key.
 * Website: https://vjs.ac.vn/
 */

import { searchOjsSite, getOjsById } from "./_ojs.js";

export const id = "vast";
export const name = "VAST Journals (Viện Hàn lâm KH&CN Việt Nam)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = [
  "vietnam_academic", "vietnam_science", "vietnam_tech", "science", "open_access",
];

/**
 * Fallback slug → journal name map. Only used when the search page does not
 * carry the journal name itself; the page always wins so a wrong entry here
 * cannot corrupt a citation.
 */
const JOURNAL_NAMES = {
  vjs:  "Vietnam Journal of Science and Technology",
  vjste: "Vietnam Journal of Science, Technology and Engineering",
  vjm:  "Vietnam Journal of Mathematics",
  vjch: "Vietnam Journal of Chemistry",
  vjc:  "Vietnam Journal of Chemistry",
  cip:  "Communications in Physics",
  vjbt: "Vietnam Journal of Biotechnology",
  vjb:  "Vietnam Journal of Biotechnology",
  jse:  "Vietnam Journal of Earth Sciences",
  vjes: "Vietnam Journal of Earth Sciences",
  jmst: "Vietnam Journal of Marine Science and Technology",
  vjmst: "Vietnam Journal of Marine Science and Technology",
  cybernetics: "Journal of Computer Science and Cybernetics",
  jcc:  "Journal of Computer Science and Cybernetics",
};

const SITE = {
  baseUrl: "https://vjs.ac.vn",
  sourceId: "vast",
  publisher: "Viện Hàn lâm Khoa học và Công nghệ Việt Nam (VAST)",
  defaultVenue: "Tạp chí Viện Hàn lâm Khoa học và Công nghệ Việt Nam (VAST)",
  journalNames: JOURNAL_NAMES,
  issn: null,
};

export async function search(query, opts = {}, _config = {}) {
  return searchOjsSite(query, opts, SITE);
}

export async function getById(paperId, _config = {}, opts = {}) {
  return getOjsById(paperId, SITE, opts.signal);
}

export { search as searchVast };
