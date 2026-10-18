import type { Dict, Raw } from "../academic/types.ts";
import { z } from "zod";
import { ok, err, fmtErr } from "../utils.ts";
import { consensus as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatAuthors(authors: Raw) {
    if (!Array.isArray(authors)) return authors || "Unknown";
    return authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "");
}

function formatPaper(paper: Raw, index: Raw, includeAbstract = true) {
    let out = `### [${index}] ${paper.title}\n`;
    if (paper.claim)         out += `**Key Finding:** ${paper.claim}\n`;
    out += `**Authors:** ${formatAuthors(paper.authors)}`;
    if (paper.year && paper.year !== "Unknown") out += ` (${paper.year})`;
    out += "\n";
    if (paper.journal)        out += `**Journal:** ${paper.journal}\n`;
    if (paper.citation_count) out += `**Citations:** ${paper.citation_count}\n`;
    if (paper.study_type)     out += `**Study Type:** ${paper.study_type}\n`;
    if (includeAbstract && paper.abstract) {
        const abstract = paper.abstract.length > 600
            ? paper.abstract.substring(0, 600) + "..."
            : paper.abstract;
        out += `**Abstract:** ${abstract}\n`;
    }
    if (paper.url) out += `**URL:** ${paper.url}\n`;
    if (paper.doi) out += `**DOI:** ${paper.doi}\n`;
    return out + "\n---\n\n";
}

async function postSidecar(path: Raw, body: Raw, timeoutMs: Raw) {
    const resp = await proxyAwareFetch(`${config.sidecarUrl}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.sidecarKey}`,
        },
        body: JSON.stringify(body),
        timeout: timeoutMs,
    });

    if (!resp.ok) {
        const errData = await (resp.json() as Promise<Raw>).catch(() => ({}));
        return { error: errData.detail || `HTTP ${resp.status}` };
    }
    return { data: (await resp.json() as Raw) };
}

// ── Shared filter fields ──────────────────────────────────────────────────────
const filterFields = {
    study_types: z.string().optional().describe(
        "Filter by study type, comma-separated. Options: rct, meta-analysis, systematic-review, observational, case-report"
    ),
    year_min: z.number().optional().describe("Filter papers published on or after this year"),
    year_max: z.number().optional().describe("Filter papers published on or before this year"),
};

// ── Tool registration ─────────────────────────────────────────────────────────
export function registerConsensusTools(server: Raw) {
    server.tool(
        "consensus_search",
        "Search academic research papers on Consensus. " +
        "Modes: " +
        "- 'standard': Returns peer-reviewed papers with titles, authors, abstracts, citations, and AI key findings. " +
        "- 'deep': Fetches multiple pages, deduplicates, ranks evidence, and returns structured summary.",
        {
            query: z.string().describe("Research question or topic to search for, e.g. 'does caffeine improve cognitive performance'"),
            mode: z.enum(["standard", "deep"]).optional().default("standard")
                .describe("Search mode: 'standard' or 'deep'"),
            limit: z.number().min(1).max(20).optional().describe("Max papers (1-20, default: 10, mode='standard' only)"),
            max_papers: z.number().min(1).max(100).optional().describe("Max deduplicated papers (1-100, default: 50, mode='deep' only)"),
            pages: z.number().min(1).max(5).optional().describe("Pages to fetch (1-5, default: 3, mode='deep' only)"),
            page_size: z.number().min(1).max(20).optional().describe("Papers per page (1-20, default: 20, mode='deep' only)"),
            include_abstracts: z.boolean().optional().describe("Include abstracts in output (default: true, mode='deep' only)"),
            ...filterFields,
        },
        async ({ query, mode, limit, max_papers, pages, page_size, include_abstracts, study_types, year_min, year_max }: Raw) => {
            try {
                const activeMode = mode || "standard";
                
                if (activeMode === "deep") {
                    const body: Dict = {
                        query,
                        max_papers:        max_papers || 50,
                        pages:             pages || 3,
                        page_size:         page_size || 20,
                        include_abstracts: include_abstracts !== false,
                    };
                    if (study_types) body.study_types = study_types;
                    if (year_min)    body.year_min    = year_min;
                    if (year_max)    body.year_max    = year_max;

                    const { data, error } = await postSidecar("/v1/consensus/deep_search", body, 120000);
                    if (error) return err(`Error deep searching Consensus: ${error}`);

                    const results = data.results || [];
                    if (results.length === 0) return ok(`No academic papers found for: "${query}"`);

                    const summary = data.evidence_summary || {};
                    let out = `## Consensus Deep Research Results: "${query}"\n\n`;
                    out += `Fetched ${data.pages_fetched || 0} page(s), returned ${results.length} ranked paper(s).\n\n`;

                    if (summary.year_range || summary.top_study_types || summary.high_citation_count != null) {
                        out += `### Evidence Summary\n`;
                        if (summary.year_range) {
                            out += `- **Year range:** ${summary.year_range.min || "unknown"}–${summary.year_range.max || "unknown"}\n`;
                        }
                        if (summary.high_citation_count != null) {
                            out += `- **High-citation papers (>=100 citations):** ${summary.high_citation_count}\n`;
                        }
                        if (Array.isArray(summary.top_study_types) && summary.top_study_types.length > 0) {
                            out += `- **Study types:** ${summary.top_study_types.map((x: Raw) => `${x.study_type} (${x.count})`).join(", ")}\n`;
                        }
                        out += "\n";
                    }

                    out += `### Ranked Papers\n\n`;
                    results.forEach((paper: Raw, i: Raw) => { out += formatPaper(paper, i + 1, include_abstracts !== false); });
                    return ok(out);
                } else {
                    const body: Dict = { query, limit: limit || 10 };
                    if (study_types) body.study_types = study_types;
                    if (year_min)    body.year_min    = year_min;
                    if (year_max)    body.year_max    = year_max;

                    const { data, error } = await postSidecar("/v1/consensus/search", body, 30000);
                    if (error) return err(`Error searching Consensus: ${error}`);

                    const results = data.results || [];
                    if (results.length === 0) return ok(`No academic papers found for: "${query}"`);

                    let out = `## Consensus Research Results: "${query}"\n\nFound ${results.length} paper(s):\n\n`;
                    results.forEach((paper: Raw, i: Raw) => { out += formatPaper(paper, i + 1, true); });
                    return ok(out);
                }
            } catch (e) {
                return err(`Failed to search Consensus: ${fmtErr(e)}.`);
            }
        }
    );
}
