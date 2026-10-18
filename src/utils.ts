/**
 * Shared MCP response helpers
 */

import type { Raw } from "./academic/types.ts";
/** Wrap text in a successful MCP content response */
export const ok = (text: Raw) => ({ content: [{ type: "text", text }] });

/** Wrap text in an error MCP content response */
export const err = (text: Raw) => ({ content: [{ type: "text", text }], isError: true });

/** Extract a readable message from an Error or unknown value */
export const fmtErr = (e: Raw) => (e instanceof Error ? e.message : String(e));
