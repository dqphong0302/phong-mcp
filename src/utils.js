/**
 * Shared MCP response helpers
 */

/** Wrap text in a successful MCP content response */
export const ok = (text) => ({ content: [{ type: "text", text }] });

/** Wrap text in an error MCP content response */
export const err = (text) => ({ content: [{ type: "text", text }], isError: true });

/** Extract a readable message from an Error or unknown value */
export const fmtErr = (e) => (e instanceof Error ? e.message : String(e));
