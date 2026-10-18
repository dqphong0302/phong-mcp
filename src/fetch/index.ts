/**
 * fetch — HTTP fetch tools for phong-mcp.
 *
 * Tools:
 *   1. fetch_url       — GET/POST with headers, cookies, auth token. HTML→Markdown.
 *   2. auth_fetch_url  — Stateful session fetch: POST login first, then GET target page.
 *                        Useful for pages behind simple form-based auth.
 */
import type { Dict, Raw } from "../academic/types.ts";
import { z } from "zod";
import { request } from "undici";
import { ok, err, fmtErr } from "../utils.ts";

const TIMEOUT_MS = 30_000;
const DEFAULT_UA =
  "phong-mcp/fetch (+https://github.com/phongdang/phong-mcp)";

// ---------------------------------------------------------------------------
// Turndown (HTML→Markdown) — lazy-loaded
// ---------------------------------------------------------------------------
let _turndown: Raw = null;
async function getTurndown() {
  if (_turndown !== null) return _turndown;
  try {
    const mod = await import("turndown");
    const TurndownService = mod.default;
    _turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    return _turndown;
  } catch {
    _turndown = false;
    return false;
  }
}

function cleanReaderHtml(html: Raw) {
  let cleaned = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav\s*>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header\s*>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer\s*>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside\s*>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // If <article> or <main> is present and contains substantial content, prioritize it
  const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                       cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (articleMatch && articleMatch[1].length > 300) {
    cleaned = articleMatch[1];
  }
  return cleaned;
}

/** Last-resort tag stripper for when turndown is not installed. */
function stripHtmlFallback(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function htmlToText(body: Raw, raw: Raw, ctype: Raw, readerMode = true) {
  if (raw || !ctype.includes("html")) {
    return { text: body, mode: "raw" };
  }
  const cleaned = readerMode ? cleanReaderHtml(body) : body;
  const td = await getTurndown();
  if (td) {
    return { text: td.turndown(cleaned), mode: "markdown" };
  }
  return { text: stripHtmlFallback(cleaned), mode: "stripped" };
}

function buildHeaders(extra: Dict = {}, authToken: Raw, cookies: Raw) {
  const headers: Record<string, string | Raw> = {
    "user-agent": DEFAULT_UA,
    accept: "text/html,application/json,*/*",
    ...extra,
  };
  if (authToken) {
    headers["authorization"] = authToken.startsWith("Bearer ")
      ? authToken
      : `Bearer ${authToken}`;
  }
  if (cookies) {
    headers["cookie"] = cookies;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Tool 1 — fetch_url (upgraded)
// ---------------------------------------------------------------------------
export function registerFetchTool(server: Raw) {
  server.tool(
    "fetch_url",
    "Fetch a URL via HTTP GET or POST, follow redirects, and return its content. Supports custom headers, Bearer token auth, cookies, and raw/JSON body. HTML is auto-converted to Markdown unless raw=true. Use max_length + start_index to paginate long pages.",
    {
      url: z.string().url().describe("Absolute URL to fetch"),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .optional()
        .describe("HTTP method (default: GET)"),
      body: z
        .string()
        .optional()
        .describe(
          "Request body as a string. For JSON, pass JSON.stringify output and set Content-Type header."
        ),
      headers: z
        .record(z.string())
        .optional()
        .describe("Additional HTTP headers as key-value pairs"),
      auth_token: z
        .string()
        .optional()
        .describe(
          "Bearer token or full Authorization header value (e.g. 'Bearer abc123' or 'Token xyz')"
        ),
      cookies: z
        .string()
        .optional()
        .describe(
          "Cookie string to attach (e.g. 'session=abc; csrftoken=xyz')"
        ),
      max_length: z
        .number()
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe("Maximum characters to return (default 5000)"),
      start_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Character offset for pagination (default 0)"),
      raw: z
        .boolean()
        .optional()
        .describe(
          "Return raw response body without HTML→Markdown conversion"
        ),
      reader_mode: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Strip navigation, headers, footers, ads, and boilerplate HTML before markdown conversion to save tokens. Default: true."
        ),
    },
    async ({
      url,
      method,
      body,
      headers: extraHeaders,
      auth_token,
      cookies,
      max_length,
      start_index,
      raw,
      reader_mode,
    }: Raw) => {
      const maxLen = max_length ?? 5000;
      const startIdx = start_index ?? 0;
      const httpMethod = method ?? "GET";
      const useReaderMode = reader_mode ?? true;

      try {
        const headers = buildHeaders(extraHeaders ?? {}, auth_token, cookies);

        const res = await request(url, {
          method: httpMethod,
          headers,
          body: body ?? undefined,
          maxRedirections: 5,
          headersTimeout: TIMEOUT_MS,
          bodyTimeout: TIMEOUT_MS,
        });

        if (res.statusCode >= 400) {
          const errBody = await res.body.text().catch(() => "");
          return err(
            `HTTP ${res.statusCode} for ${url}\n${errBody.slice(0, 500)}`
          );
        }

        const ctype = (
          res.headers["content-type"] || ""
        )
          .toString()
          .toLowerCase();
        const rawBody = await res.body.text();

        const { text, mode } = await htmlToText(rawBody, raw, ctype, useReaderMode);

        const total = text.length;
        const slice = text.slice(startIdx, startIdx + maxLen);
        const truncated = startIdx + maxLen < total;
        const nextHint = truncated
          ? `\n\n[truncated — call again with start_index=${
              startIdx + maxLen
            } to continue; total ${total} chars]`
          : "";

        // Extract response cookies for chaining
        const setCookie = res.headers["set-cookie"];
        const responseCookies = Array.isArray(setCookie)
          ? setCookie.map((c) => c.split(";")[0]).join("; ")
          : setCookie
          ? setCookie.split(";")[0]
          : null;

        return {
          ...ok(slice + nextHint),
          structuredContent: {
            url,
            method: httpMethod,
            status: res.statusCode,
            content_type: ctype,
            mode,
            total_length: total,
            start_index: startIdx,
            returned_length: slice.length,
            truncated,
            ...(responseCookies
              ? { response_cookies: responseCookies }
              : {}),
          },
        };
      } catch (e) {
        return err(`fetch_url failed: ${fmtErr(e)}`);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Tool 2 — auth_fetch_url
// ---------------------------------------------------------------------------
export function registerAuthFetchTool(server: Raw) {
  server.tool(
    "auth_fetch_url",
    "Fetch a URL that requires authentication. Step 1: POST credentials to a login endpoint (supports form data or JSON). Step 2: Use session cookies from the login response to GET the target page. Useful for Notion-like private pages, Jira, Confluence, internal dashboards.",
    {
      target_url: z
        .string()
        .url()
        .describe("The page URL to fetch after successful login"),
      login_url: z
        .string()
        .url()
        .optional()
        .describe(
          "Login endpoint URL to POST credentials to. If omitted, no pre-login step is performed."
        ),
      login_body: z
        .string()
        .optional()
        .describe(
          "Login POST body. For form: 'username=x&password=y'. For JSON: '{\"email\":\"x\",\"password\":\"y\"}'"
        ),
      login_content_type: z
        .string()
        .optional()
        .describe(
          "Content-Type for login POST. Defaults to 'application/x-www-form-urlencoded'. Use 'application/json' for JSON APIs."
        ),
      auth_token: z
        .string()
        .optional()
        .describe("Bearer/API token to attach on the target request"),
      extra_cookies: z
        .string()
        .optional()
        .describe("Additional cookies to send on top of session cookies"),
      max_length: z
        .number()
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe("Max characters to return (default 10000)"),
      raw: z
        .boolean()
        .optional()
        .describe("Return raw HTML/body without Markdown conversion"),
    },
    async ({
      target_url,
      login_url,
      login_body,
      login_content_type,
      auth_token,
      extra_cookies,
      max_length,
      raw,
    }: Raw) => {
      const maxLen = max_length ?? 10_000;
      let sessionCookies = extra_cookies ?? "";

      try {
        // --- Step 1: Login ---
        if (login_url && login_body) {
          const ct =
            login_content_type ?? "application/x-www-form-urlencoded";
          const loginRes = await request(login_url, {
            method: "POST",
            headers: {
              "content-type": ct,
              "user-agent": DEFAULT_UA,
            },
            body: login_body,
            maxRedirections: 5,
            headersTimeout: TIMEOUT_MS,
            bodyTimeout: TIMEOUT_MS,
          });

          // Extract session cookies from login response
          const setCookie = loginRes.headers["set-cookie"];
          const loginCookies = Array.isArray(setCookie)
            ? setCookie.map((c) => c.split(";")[0]).join("; ")
            : setCookie
            ? setCookie.split(";")[0]
            : "";

          if (loginCookies) {
            sessionCookies = sessionCookies
              ? `${loginCookies}; ${sessionCookies}`
              : loginCookies;
          }

          // Drain body
          await loginRes.body.text().catch(() => {});

          if (loginRes.statusCode >= 400) {
            return err(
              `Login step failed with HTTP ${loginRes.statusCode} at ${login_url}`
            );
          }
        }

        // --- Step 2: Fetch target ---
        const headers = buildHeaders({}, auth_token, sessionCookies);
        const res = await request(target_url, {
          method: "GET",
          headers,
          maxRedirections: 5,
          headersTimeout: TIMEOUT_MS,
          bodyTimeout: TIMEOUT_MS,
        });

        if (res.statusCode >= 400) {
          return err(
            `Target page returned HTTP ${res.statusCode} for ${target_url}`
          );
        }

        const ctype = (res.headers["content-type"] || "")
          .toString()
          .toLowerCase();
        const rawBody = await res.body.text();
        const { text, mode } = await htmlToText(rawBody, raw, ctype);

        const slice = text.slice(0, maxLen);
        const truncated = maxLen < text.length;
        const nextHint = truncated
          ? `\n\n[truncated at ${maxLen} chars; total ${text.length} chars]`
          : "";

        // Expose cookies so user can chain further calls
        const setCookieTarget = res.headers["set-cookie"];
        const responseCookies = Array.isArray(setCookieTarget)
          ? setCookieTarget.map((c) => c.split(";")[0]).join("; ")
          : setCookieTarget
          ? setCookieTarget.split(";")[0]
          : null;

        const allCookies =
          [sessionCookies, responseCookies].filter(Boolean).join("; ") ||
          null;

        return {
          ...ok(slice + nextHint),
          structuredContent: {
            target_url,
            login_performed: !!login_url,
            status: res.statusCode,
            content_type: ctype,
            mode,
            total_length: text.length,
            returned_length: slice.length,
            truncated,
            ...(allCookies ? { session_cookies: allCookies } : {}),
          },
        };
      } catch (e) {
        return err(`auth_fetch_url failed: ${fmtErr(e)}`);
      }
    }
  );
}
