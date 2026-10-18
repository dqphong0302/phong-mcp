import { errorMessage } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from 'zod';
import { medical as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";
import { ok, err } from "../utils.ts";

export function registerMedicalTools(server: Raw) {
  server.tool(
    "medical_research",
    "Unified medical search and clinical Q&A tool. " +
    "Modes: " +
    "- 'search': Search medical literature across PubMed, BioRxiv, and Semantic Scholar. " +
    "- 'clinical_qa': Ask clinical questions to OpenEvidence.",
    {
      query: z.string().describe("The search query or clinical question."),
      mode: z.enum(["search", "clinical_qa"]).optional().default("search")
        .describe("Research mode: 'search' (default) or 'clinical_qa'"),
      source: z.enum(["pubmed", "biorxiv", "semantic_scholar", "google_scholar", "all"]).optional().default("all")
        .describe("Search source (for mode='search' only)"),
      targetUrl: z.string().optional()
        .describe("Optional target API url for OpenEvidence (for mode='clinical_qa' only, default: https://www.openevidence.com/api/chat)"),
    },
    async ({ query, mode, source, targetUrl }: Raw) => {
      try {
        const activeMode = mode || "search";

        if (activeMode === "clinical_qa") {
          const resp = await proxyAwareFetch(`${config.sidecarUrl}/openevidence`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(targetUrl && { 'x-target-url': targetUrl })
            },
            body: JSON.stringify({ query })
          });
          
          if (!resp.ok) {
            const errData = await resp.text();
            throw new Error(`OpenEvidence Proxy Failed: ${resp.status} - ${errData}`);
          }
          
          const data = (await resp.json() as Raw);
          return ok(JSON.stringify(data, null, 2));
        } else {
          // search mode
          const activeSource = source || "all";
          const results = [];
          
          const fetchSource = async (src: Raw) => {
            let endpoint = src;
            if (src === 'semantic_scholar') endpoint = 'semantic-scholar';
            if (src === 'google_scholar') endpoint = 'google-scholar';
            const resp = await proxyAwareFetch(`${config.sidecarUrl}/${endpoint}?q=${encodeURIComponent(query)}`);
            if (!resp.ok) {
              throw new Error(`Failed to fetch from ${src}: HTTP ${resp.status}`);
            }
            const data = (await resp.json() as Raw);
            return data.results.map((r: Raw) => ({ source: src, ...r }));
          };

          if (activeSource === 'all') {
            const [pubmed, biorxiv, semantic, scholar] = await Promise.allSettled([
              fetchSource('pubmed'),
              fetchSource('biorxiv'),
              fetchSource('semantic_scholar'),
              fetchSource('google_scholar')
            ]);
            
            if (pubmed.status === 'fulfilled') results.push(...pubmed.value);
            if (biorxiv.status === 'fulfilled') results.push(...biorxiv.value);
            if (semantic.status === 'fulfilled') results.push(...semantic.value);
            if (scholar.status === 'fulfilled') results.push(...scholar.value);
          } else {
            const res = await fetchSource(activeSource);
            results.push(...res);
          }

          return ok(JSON.stringify(results, null, 2));
        }
      } catch (error) {
        return err(errorMessage(error));
      }
    }
  );

  // ── medical_terms_lookup ───────────────────────────────────────────────
  server.tool(
    "medical_terms_lookup",
    "Zero-token clinical abbreviation expander and medical terminology dictionary (Vietnamese & English). " +
    "Modes: " +
    "- 'lookup': Look up a specific abbreviation (e.g. 'THA', 'COPD', 'eGFR', 'NMCT'). " +
    "- 'expand_text': Scan a paragraph of clinical notes/text and auto-expand all medical acronyms with dual VN/EN definitions.",
    {
      query: z.string().describe("Medical abbreviation (e.g. 'THA') or paragraph of clinical text to expand."),
      mode: z.enum(["lookup", "expand_text"]).optional().default("lookup")
        .describe("Mode: 'lookup' for single acronym meaning, 'expand_text' for full paragraph expansion."),
    },
    async ({ query, mode }: Raw) => {
      try {
        const { lookupMedicalAbbreviation, expandMedicalText } = await import("./terms.ts");
        if (mode === "expand_text") {
          const res = expandMedicalText(query);
          return ok(JSON.stringify(res, null, 2));
        }
        const res = lookupMedicalAbbreviation(query);
        return ok(JSON.stringify(res, null, 2));
      } catch (error) {
        return err(`medical_terms_lookup failed: ${errorMessage(error)}`);
      }
    }
  );
}

