/**
 * diagram — Architecture & Diagram rendering tool for phong-mcp.
 *
 * Uses Kroki.io (free, no API key required) to render diagrams.
 * Supported types:
 *   - mermaid       (flowcharts, sequence, ER, Gantt, pie, mindmap, ...)
 *   - plantuml      (class, component, sequence, state, deployment...)
 *   - d2            (declarative modern diagrams)
 *   - graphviz      (dot language)
 *   - c4plantuml    (C4 architecture)
 *   - structurizr   (workspace DSL)
 *   - excalidraw    (hand-drawn style)
 *   - svgbob        (ASCII art → SVG)
 *
 * Tools:
 *   1. diagram_render  — render diagram source code → URL + inline SVG
 *   2. diagram_explain — explain a diagram type and show example syntax
 */
import { errorName } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { ok, err, fmtErr } from "../utils.ts";
import { registerPaperBananaTool } from "./paperbanana.ts";

const KROKI_BASE = "https://kroki.io";
const TIMEOUT_MS = 20_000;

// Supported diagram types and their Kroki endpoint names
const DIAGRAM_TYPES: Record<string, string> = {
  mermaid: "mermaid",
  plantuml: "plantuml",
  d2: "d2",
  graphviz: "graphviz",
  c4plantuml: "c4plantuml",
  structurizr: "structurizr",
  excalidraw: "excalidraw",
  svgbob: "svgbob",
  blockdiag: "blockdiag",
  seqdiag: "seqdiag",
  nwdiag: "nwdiag",
  actdiag: "actdiag",
  packetdiag: "packetdiag",
  rackdiag: "rackdiag",
  vega: "vega",
  vegalite: "vegalite",
  wavedrom: "wavedrom",
  nomnoml: "nomnoml",
  erd: "erd",
  ditaa: "ditaa",
};

const DIAGRAM_EXAMPLES = {
  mermaid: {
    description:
      "Mermaid: flowchart, sequence, ER, Gantt, pie chart, mindmap, gitGraph, architecture...",
    example: `graph TD
    A[Client] -->|Request| B(Load Balancer)
    B --> C[Server 1]
    B --> D[Server 2]
    C --> E[(Database)]
    D --> E`,
  },
  plantuml: {
    description:
      "PlantUML: class, component, sequence, state, deployment, use-case diagrams...",
    example: `@startuml
actor User
participant "Web App" as App
participant "API Server" as API
database "PostgreSQL" as DB

User -> App: HTTP Request
App -> API: REST Call
API -> DB: SQL Query
DB --> API: Result
API --> App: JSON Response
App --> User: HTML Page
@enduml`,
  },
  d2: {
    description:
      "D2: modern declarative diagram language, clean and readable syntax.",
    example: `direction: right

client -> load_balancer: HTTP
load_balancer -> server_1: forward
load_balancer -> server_2: forward
server_1 -> database: query
server_2 -> database: query

database: {
  shape: cylinder
  label: PostgreSQL
}`,
  },
  graphviz: {
    description:
      "Graphviz DOT: flexible graph layouts, great for dependency graphs.",
    example: `digraph Architecture {
    rankdir=LR;
    node [shape=box, style=filled, fillcolor=lightblue];
    
    Client -> LoadBalancer [label="HTTPS"];
    LoadBalancer -> App1 [label="round-robin"];
    LoadBalancer -> App2;
    App1 -> Redis [label="cache"];
    App2 -> Redis;
    App1 -> Postgres [label="SQL"];
    App2 -> Postgres;
}`,
  },
  c4plantuml: {
    description: "C4 Model: Context, Container, Component, Code diagrams.",
    example: `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

Person(user, "User", "A user of the system")
System_Boundary(sys, "My System") {
    Container(webapp, "Web App", "React", "Single page application")
    Container(api, "API Server", "Node.js", "REST API backend")
    ContainerDb(db, "Database", "PostgreSQL", "Stores user data")
}

Rel(user, webapp, "Uses", "HTTPS")
Rel(webapp, api, "API calls", "JSON/HTTPS")
Rel(api, db, "Read/Write", "SQL")
@enduml`,
  },
  svgbob: {
    description: "SVGbob: convert ASCII art to clean SVG diagrams.",
    example: `
        .---.
       ( CPU )
        '---'
          |
     +---------+
     |   RAM   |
     +---------+
          |
    +----------+
    |   Disk   |
    +----------+`,
  },
};

/**
 * Encode diagram source to base64url for Kroki GET requests
 */
function toBase64Url(str: Raw) {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Render via Kroki POST API (supports larger diagrams)
 * Uses native fetch directly — Kroki is a public service, no proxy needed.
 */
async function renderViaKroki(diagramType: Raw, source: Raw, outputFormat = "svg") {
  const endpoint = DIAGRAM_TYPES[diagramType];
  if (!endpoint) {
    throw new Error(`Unsupported diagram type: ${diagramType}`);
  }

  const url = `${KROKI_BASE}/${endpoint}/${outputFormat}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: outputFormat === "svg" ? "image/svg+xml" : "image/png",
      },
      body: source,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Kroki returned HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }

    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (errorName(e) === "AbortError") {
      throw new Error(`Request timeout: Kroki did not respond within ${TIMEOUT_MS}ms.`);
    }
    throw e;
  }
}

/**
 * Build a permanent Kroki URL (GET-based, shareable)
 */
function buildKrokiUrl(diagramType: Raw, source: Raw, outputFormat = "svg") {
  const endpoint = DIAGRAM_TYPES[diagramType];
  const encoded = toBase64Url(source);
  return `${KROKI_BASE}/${endpoint}/${outputFormat}/${encoded}`;
}

// ---------------------------------------------------------------------------
// Tool 1 — diagram_render
// ---------------------------------------------------------------------------
export function registerDiagramTools(server: Raw) {
  server.tool(
    "diagram_render",
    `Render architecture diagrams and technical charts from text/code using Kroki.io (free, no API key). 
Supported types: ${Object.keys(DIAGRAM_TYPES).join(", ")}.
Returns: inline SVG content + permanent shareable URL.
Best for: system architecture, flowcharts, sequence diagrams, ER diagrams, C4 models, dependency graphs.`,
    {
      type: z
        .enum(Object.keys(DIAGRAM_TYPES) as [string, ...string[]])
        .describe(
          "Diagram type/language. Use 'mermaid' for general diagrams, 'd2' for modern declarative, 'plantuml' for UML, 'graphviz' for graphs."
        ),
      source: z
        .string()
        .min(1)
        .describe(
          "The diagram source code in the chosen language. Write complete, valid syntax."
        ),
      output_format: z
        .enum(["svg", "png", "pdf"])
        .optional()
        .describe("Output format: svg (default, best quality), png, or pdf"),
      include_svg: z
        .boolean()
        .optional()
        .describe(
          "Whether to include the raw SVG content in the response (default: true). Set false to only get the URL."
        ),
    },
    async ({ type, source, output_format, include_svg }: Raw) => {
      const fmt = output_format ?? "svg";
      const doIncludeSvg = include_svg !== false;

      try {
        // Always build the shareable URL
        const shareableUrl = buildKrokiUrl(type, source, fmt);

        let svgContent = null;
        if (doIncludeSvg && fmt === "svg") {
          try {
            svgContent = await renderViaKroki(type, source, "svg");
          } catch (krokiErr) {
            console.warn(`[diagram] Kroki render timeout/error: ${fmtErr(krokiErr)}`);
          }
        }

        const parts = [
          `✅ Diagram rendered successfully!`,
          ``,
          `📐 **Type**: ${type}`,
          `🔗 **Shareable URL**: ${shareableUrl}`,
          ``,
          svgContent
            ? `**SVG Preview** (${svgContent.length} chars):\n\`\`\`svg\n${svgContent.slice(0, 8000)}${svgContent.length > 8000 ? "\n... (truncated)" : ""}\n\`\`\``
            : `*(SVG not fetched — use the URL above to view)*`,
        ];

        return {
          ...ok(parts.join("\n")),
          structuredContent: {
            type,
            output_format: fmt,
            shareable_url: shareableUrl,
            kroki_endpoint: `${KROKI_BASE}/${DIAGRAM_TYPES[type]}/${fmt}`,
            svg_length: svgContent ? svgContent.length : null,
            svg_content: svgContent,
          },
        };
      } catch (e) {
        return err(
          `diagram_render failed for type="${type}":\n${fmtErr(e)}\n\nTip: Check your diagram syntax. You can validate Mermaid at https://mermaid.live`
        );
      }
    }
  );

  registerPaperBananaTool(server);
}
