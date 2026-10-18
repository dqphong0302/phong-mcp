/**
 * `medical_search` — compatibility tool carried over from the retired phong-mcp-rust gateway.
 * Thin wrapper over the medical sidecar (one source per call, default pubmed).
 */
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { medical as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";
import { ok, err } from "../utils.ts";

export function registerMedicalSearchAlias(server: Raw) {
  server.tool(
    "medical_search",
    "Query PubMed, Semantic Scholar, BioRxiv or Google Scholar databases for medical literature.",
    {
      query: z.string().describe("The medical query search term"),
      source: z.enum(["pubmed", "semantic-scholar", "biorxiv", "google-scholar"]).optional().default("pubmed"),
    },
    { title: "Search Medical Literature", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ query, source }: Raw) => {
      try {
        const resp = await proxyAwareFetch(`${config.sidecarUrl}/${source || "pubmed"}?q=${encodeURIComponent(query)}`);
        if (!resp.ok) return err(`Medical Sidecar error: ${resp.status}`);
        return ok(JSON.stringify((await resp.json() as Raw), null, 2));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
