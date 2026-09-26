/**
 * PRISMA 2020 Flow Diagram Generator.
 * Standardized Systematic Review flow reporting compliant with PRISMA 2020 guidelines.
 * Docs: http://www.prisma-statement.org/PRISMAStatement/FlowDiagram
 */

/**
 * Generate PRISMA 2020 Flow Diagram in Mermaid, Markdown, and ASCII format.
 *
 * @param {Object} input
 * @param {Object} [input.identification] Database counts { pubmed: 120, arxiv: 85, s2: 240, ... }
 * @param {number} [input.duplicates_removed] Duplicates removed count
 * @param {number} [input.records_screened] Total records screened (Title/Abstract)
 * @param {number} [input.records_excluded] Records excluded at screening
 * @param {Array<{ reason: string, count: number }>} [input.screening_exclusion_reasons]
 * @param {number} [input.reports_sought] Full-text reports sought for retrieval
 * @param {number} [input.reports_not_retrieved] Reports not retrieved (paywalled/broken)
 * @param {number} [input.reports_assessed] Full-text reports assessed for eligibility
 * @param {number} [input.reports_excluded] Full-text reports excluded
 * @param {Array<{ reason: string, count: number }>} [input.eligibility_exclusion_reasons]
 * @param {number} [input.studies_included_review] Studies included in qualitative synthesis
 * @param {number} [input.studies_included_meta_analysis] Studies included in quantitative meta-analysis
 * @param {string} [input.title] Optional title for the systematic review
 * @returns {Object} { mermaid: string, markdown: string, summary: Object }
 */
export function generatePrismaFlowDiagram(input = {}) {
  const title = input.title || "PRISMA 2020 Flow Diagram";
  const identification = input.identification || {};

  const totalIdentified = Object.values(identification).reduce((a, b) => a + Number(b || 0), 0)
    || input.total_identified || 0;

  const duplicatesRemoved = input.duplicates_removed || 0;
  const recordsScreened = input.records_screened || Math.max(0, totalIdentified - duplicatesRemoved);
  const recordsExcluded = input.records_excluded || 0;

  const reportsSought = input.reports_sought || Math.max(0, recordsScreened - recordsExcluded);
  const reportsNotRetrieved = input.reports_not_retrieved || 0;
  const reportsAssessed = input.reports_assessed || Math.max(0, reportsSought - reportsNotRetrieved);

  const reportsExcluded = input.reports_excluded || 0;
  const eligibilityReasons = input.eligibility_exclusion_reasons || [];
  const studiesIncludedReview = input.studies_included_review || Math.max(0, reportsAssessed - reportsExcluded);
  const studiesIncludedMeta = input.studies_included_meta_analysis || studiesIncludedReview;

  // Breakdown text for identification databases
  const idBreakdown = Object.entries(identification)
    .map(([db, count]) => `${db.toUpperCase()} (n = ${count})`)
    .join("<br/>") || `Databases (n = ${totalIdentified})`;

  const idExcludeBreakdown = eligibilityReasons
    .map((r) => `${r.reason} (n = ${r.count})`)
    .join("<br/>") || `Ineligible records (n = ${reportsExcluded})`;

  // Generate clean Mermaid flowchart
  const mermaid = `flowchart TD
    classDef idPhase fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef screenPhase fill:#fff8e1,stroke:#ffa000,stroke-width:2px,color:#ff6f00;
    classDef includePhase fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;
    classDef excludeBox fill:#ffebee,stroke:#d32f2f,stroke-width:1px,color:#b71c1c;

    subgraph Identification ["<b>IDENTIFICATION</b>"]
        A["<b>Records identified from databases:</b><br/>${idBreakdown}<br/><b>Total (n = ${totalIdentified})</b>"]:::idPhase
        B["<b>Duplicate records removed:</b><br/>(n = ${duplicatesRemoved})"]:::excludeBox
    end

    subgraph Screening ["<b>SCREENING</b>"]
        C["<b>Records screened (Title/Abstract):</b><br/>(n = ${recordsScreened})"]:::screenPhase
        D["<b>Records excluded:</b><br/>(n = ${recordsExcluded})"]:::excludeBox
        E["<b>Reports sought for retrieval:</b><br/>(n = ${reportsSought})"]:::screenPhase
        F["<b>Reports not retrieved:</b><br/>(n = ${reportsNotRetrieved})"]:::excludeBox
        G["<b>Reports assessed for eligibility:</b><br/>(n = ${reportsAssessed})"]:::screenPhase
        H["<b>Reports excluded:</b><br/>${idExcludeBreakdown}<br/><b>Total excluded (n = ${reportsExcluded})</b>"]:::excludeBox
    end

    subgraph Included ["<b>INCLUDED</b>"]
        I["<b>Studies included in qualitative review:</b><br/>(n = ${studiesIncludedReview})"]:::includePhase
        J["<b>Studies included in meta-analysis:</b><br/>(n = ${studiesIncludedMeta})"]:::includePhase
    end

    A --> B
    A --> C
    C --> D
    C --> E
    E --> F
    E --> G
    G --> H
    G --> I
    I --> J
`;

  // Markdown summary table & report
  const markdown = `## ${title} (PRISMA 2020 Standard)

\`\`\`mermaid
${mermaid}
\`\`\`

### PRISMA 2020 Extraction Metrics
| Phase | Metric Description | Count ($n$) |
|---|---|:---:|
| **Identification** | Total records identified across databases | **${totalIdentified}** |
| | Duplicates removed prior to screening | ${duplicatesRemoved} |
| **Screening** | Records screened by title/abstract | **${recordsScreened}** |
| | Records excluded during title/abstract screening | ${recordsExcluded} |
| | Full-text reports sought for retrieval | ${reportsSought} |
| | Reports not retrieved (paywalled / unobtainable) | ${reportsNotRetrieved} |
| **Eligibility** | Full-text reports assessed for eligibility | **${reportsAssessed}** |
| | Full-text reports excluded with reasons | ${reportsExcluded} |
| **Included** | **Studies included in systematic review** | **${studiesIncludedReview}** |
| | **Studies included in quantitative meta-analysis** | **${studiesIncludedMeta}** |
`;

  return {
    title,
    mermaid,
    markdown,
    summary: {
      totalIdentified,
      duplicatesRemoved,
      recordsScreened,
      recordsExcluded,
      reportsAssessed,
      reportsExcluded,
      studiesIncludedReview,
      studiesIncludedMeta,
    },
  };
}
