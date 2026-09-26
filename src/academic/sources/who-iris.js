/**
 * WHO IRIS — the World Health Organization's institutional repository:
 * guidelines, disease outbreak reports, the pharmacopoeia, global health
 * policy. Free, no key.
 *
 * NOTE (fixed 2026-08-28): this plugin previously queried OpenAlex with the
 * words "WHO World Health Organization" glued onto the user's query, which
 * returned any paper that happened to mention WHO — not IRIS documents at all.
 * IRIS runs DSpace 7, so it is now queried directly through its own discovery
 * API and returns real repository records.
 *
 * Repository: https://iris.who.int/
 */

import { searchDspace } from "./_dspace.js";

export const id = "who_iris";
export const name = "WHO IRIS (kho tài liệu chính thức của Tổ chức Y tế Thế giới)";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["public_health", "who", "epidemiology", "health_policy", "medicine"];

const SITE = {
  baseUrl: "https://iris.who.int",
  sourceId: "who_iris",
  publisher: "World Health Organization (WHO)",
  defaultVenue: "WHO Institutional Repository for Information Sharing (IRIS)",
  type: "policy_report",
};

export async function search(query, opts = {}, _config = {}) {
  return searchDspace(query, opts, SITE);
}

export { search as searchWhoIris };
