/**
 * Scrapling MCP Tools — Stealth & Adaptive Web Scraping
 *
 * Tools:
 *   1. scrape_url: Anti-bot bypass web scraper using Scrapling + Camoufox + curl_cffi.
 *   2. scrape_extract: Adaptive CSS/XPath selector extractor.
 */

import { errorMessage } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { request } from "undici";
import { scrapling } from "../config.ts";
import { ok, err, fmtErr } from "../utils.ts";

async function callScraplingEndpoint(endpoint: Raw, payload: Raw) {
  const url = `${scrapling.sidecarUrl}${endpoint}`;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (scrapling.apiKey) {
      headers["authorization"] = `Bearer ${scrapling.apiKey}`;
    }
    const res = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      headersTimeout: scrapling.timeoutMs,
      bodyTimeout: scrapling.timeoutMs,
    });

    if (res.statusCode >= 400) {
      const errText = await res.body.text();
      return { error: `Scrapling sidecar error (${res.statusCode}): ${errText}` };
    }

    const data = (await res.body.json() as Raw);
    return { data };
  } catch (e) {
    return { error: `Failed to connect to Scrapling sidecar at ${url}: ${errorMessage(e)}` };
  }
}

export function registerScrapeTools(server: Raw) {
  // ── 1. scrape_url ────────────────────────────────────────────────────────
  server.tool(
    "scrape_url",
    "Deep stealth web scraper powered by Scrapling + Camoufox. Bypasses Cloudflare Turnstile, DataDome, and bot protections to extract full page content, academic articles, paywalled landing pages, and clean Markdown.",
    {
      url: z.string().url().describe("Target web page URL to scrape"),
      stealth: z.boolean().optional().default(true).describe("Enable stealth anti-bot bypass mode (default: true)"),
      render_js: z.boolean().optional().default(false).describe("Execute JavaScript via headless browser (default: false)"),
      format: z.enum(["markdown", "text", "html"]).optional().default("markdown").describe("Output format: markdown (default), text, or html"),
      max_length: z.number().int().positive().optional().default(40000).describe("Maximum character count to return (default: 40000)"),
      extract_article: z.boolean().optional().default(true).describe("Use Readability parser to extract main article body and strip noise (default: true)"),
      timeout: z.number().int().positive().optional().default(30).describe("Timeout in seconds (default: 30)"),
    },
    async ({ url, stealth = true, render_js = false, format = "markdown", max_length = 40000, extract_article = true, timeout = 30 }: Raw) => {
      try {
        const result = await callScraplingEndpoint("/v1/scrape", {
          url,
          stealth,
          render_js,
          format,
          max_length,
          extract_article,
          timeout,
        });

        if (result.error) {
          return err(result.error);
        }

        const d = result.data;
        const formatted = [
          `# ${d.title || "Scraped Page"}`,
          `**URL:** ${d.url}`,
          d.description ? `**Description:** ${d.description}` : null,
          `**Status:** ${d.status_code} | **Length:** ${d.content_length} chars | **Format:** ${d.format}`,
          "---",
          d.content,
        ]
          .filter(Boolean)
          .join("\n\n");

        return ok(formatted);
      } catch (e) {
        return err(`scrape_url failed: ${fmtErr(e)}`);
      }
    }
  );

  // ── 2. scrape_extract ────────────────────────────────────────────────────
  server.tool(
    "scrape_extract",
    "Extract structured data from web pages using adaptive CSS/XPath selectors. Automatically heals and adapts when site structure changes.",
    {
      url: z.string().url().describe("Target URL"),
      selectors: z.record(z.string()).describe("Dictionary of field names to CSS or XPath selector strings"),
      stealth: z.boolean().optional().default(true).describe("Enable stealth anti-bot mode"),
      timeout: z.number().int().positive().optional().default(30).describe("Timeout in seconds"),
    },
    async ({ url, selectors, stealth = true, timeout = 30 }: Raw) => {
      try {
        const result = await callScraplingEndpoint("/v1/extract", {
          url,
          selectors,
          stealth,
          timeout,
        });

        if (result.error) {
          return err(result.error);
        }

        return ok(JSON.stringify(result.data, null, 2));
      } catch (e) {
        return err(`scrape_extract failed: ${fmtErr(e)}`);
      }
    }
  );
}
