import { z } from "zod";
import { ok, err, fmtErr } from "../utils.js";

// ── Config (read once at startup) ─────────────────────────────────────────────
const SIDECAR_URL = process.env.CONSENSUS_SIDECAR_URL || "http://10.10.10.100:8767";
const SIDECAR_KEY = process.env.CONSENSUS_SIDECAR_KEY || "sk-consensus-proxy-48d2f70b2c149";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatAuthors(authors) {
    if (!Array.isArray(authors)) return authors || "Unknown";
    return authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "");
}

function formatPaper(paper, index, includeAbstract = true) {
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

async function postSidecar(path, body, timeoutMs) {
    const resp = await fetch(`${SIDECAR_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SIDECAR_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return { error: errData.detail || `HTTP ${resp.status}` };
    }
    return { data: await resp.json() };
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
export function registerConsensusTools(server) {
    server.tool(
        "consensus_search_papers",
        "Search for academic research papers on Consensus. Returns peer-reviewed papers with titles, authors, abstracts, citations, and AI-extracted key findings.",
        {
            query: z.string().describe(
                "Research question or topic to search for, e.g. 'does caffeine improve cognitive performance'"
            ),
            limit: z.number().min(1).max(20).default(10).describe(
                "Maximum number of papers to return (1-20, default: 10)"
            ),
            ...filterFields,
        },
        async ({ query, limit, study_types, year_min, year_max }) => {
            try {
                const body = { query, limit: limit || 10 };
                if (study_types) body.study_types = study_types;
                if (year_min)    body.year_min    = year_min;
                if (year_max)    body.year_max    = year_max;

                const { data, error } = await postSidecar("/v1/consensus/search", body, 30000);
                if (error) return err(`Error searching Consensus: ${error}`);

                const results = data.results || [];
                if (results.length === 0) return ok(`No academic papers found for: "${query}"`);

                let out = `## Consensus Research Results: "${query}"\n\nFound ${results.length} paper(s):\n\n`;
                results.forEach((paper, i) => { out += formatPaper(paper, i + 1, true); });
                return ok(out);
            } catch (e) {
                return err(`Failed to search Consensus: ${fmtErr(e)}.`);
            }
        }
    );

    server.tool(
        "consensus_deep_search_papers",
        "Deep search academic papers on Consensus by fetching multiple pages, deduplicating papers, ranking evidence quality, and returning a structured research-oriented summary.",
        {
            query: z.string().describe("Research question or topic to investigate deeply"),
            max_papers: z.number().min(1).max(100).default(50).describe(
                "Maximum number of deduplicated ranked papers to return (1-100, default: 50)"
            ),
            pages: z.number().min(1).max(5).default(3).describe(
                "Number of Consensus result pages to fetch (1-5, default: 3)"
            ),
            page_size: z.number().min(1).max(20).default(20).describe(
                "Papers per page to request from Consensus (1-20, default: 20)"
            ),
            include_abstracts: z.boolean().default(true).describe(
                "Include abstracts in output (default: true)"
            ),
            ...filterFields,
        },
        async ({ query, max_papers, pages, page_size, study_types, year_min, year_max, include_abstracts }) => {
            try {
                const body = {
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
                        out += `- **Study types:** ${summary.top_study_types.map((x) => `${x.study_type} (${x.count})`).join(", ")}\n`;
                    }
                    out += "\n";
                }

                out += `### Ranked Papers\n\n`;
                results.forEach((paper, i) => { out += formatPaper(paper, i + 1, include_abstracts !== false); });
                return ok(out);
            } catch (e) {
                return err(`Failed to deep search Consensus: ${fmtErr(e)}.`);
            }
        }
    );
}
