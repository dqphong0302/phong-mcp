/**
 * OpenReview source plugin.
 * Free, no API key required.
 * API: https://api2.openreview.net/notes/search
 * Covers top conferences: NeurIPS, ICLR, ICML, AAAI, CVPR
 */
import { fromOpenReview } from "../formatter.js";

export const id = "openreview";
export const name = "OpenReview";
export const requiresKey = false;
export const keyEnvVar = null;
export const domains = ["cs", "ml", "ai"];

const API = "https://api2.openreview.net";

/**
 * Optional credentials for OpenReview's documented login endpoint.
 *
 * Set OPENREVIEW_TOKEN, or OPENREVIEW_USERNAME + OPENREVIEW_PASSWORD, to let
 * the adapter resolve a reviewer note back to the submission it belongs to.
 * Without them the adapter still works — it just returns fewer papers, because
 * the anonymous /notes endpoint is gated behind a bot challenge that this code
 * deliberately does not attempt to defeat. Supplying an account is the
 * supported way in; nothing here rotates identities or solves challenges.
 */
function credentials() {
  return {
    token: process.env.OPENREVIEW_TOKEN || "",
    username: process.env.OPENREVIEW_USERNAME || "",
    password: process.env.OPENREVIEW_PASSWORD || "",
  };
}

let _tokenCache = { value: "", expires: 0 };

/** Bearer token from env, or from a login with env credentials. Null if unset. */
async function authToken(signal) {
  const { token, username, password } = credentials();
  if (token) return token;
  if (!username || !password) return null;
  if (_tokenCache.value && Date.now() < _tokenCache.expires) return _tokenCache.value;

  try {
    const resp = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: username, password }),
      signal: signal || AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.token) return null;
    // OpenReview tokens are short-lived; re-login well before expiry.
    _tokenCache = { value: data.token, expires: Date.now() + 45 * 60 * 1000 };
    return data.token;
  } catch {
    return null;
  }
}

/**
 * Resolve forum ids to their submission notes. Requires credentials; returns an
 * empty map without them rather than retrying the anonymous endpoint.
 *
 * @param {string[]} forumIds
 * @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, Object>>}
 */
async function resolveForums(forumIds, signal) {
  const out = new Map();
  const token = await authToken(signal);
  if (!token || forumIds.length === 0) return out;

  for (const id of forumIds) {
    try {
      const resp = await fetch(`${API}/notes?id=${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: signal || AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const note = (await resp.json())?.notes?.[0];
      if (note && isSubmissionNote(note)) out.set(id, note);
    } catch {
      // A forum that cannot be resolved is simply left out.
    }
  }
  return out;
}

/**
 * Note invitations that are review apparatus rather than a paper: referee
 * reports, rebuttals, meta-reviews and decisions. They carry no title, so they
 * used to surface as a page of "(untitled)" results — typically 11 of every 12
 * hits. The submission they belong to cannot be resolved here: the /notes
 * endpoint that maps a forum id to its paper is behind a bot challenge.
 */
const APPARATUS_INVITATION_RE =
  /\/-\/(?:Official_Review|Official_Comment|Public_Comment|Meta_Review|Decision|Rebuttal|Withdrawal|Desk_Rejection|Ethics_Review)$/i;

/** A note is usable only if it is a paper and carries a real title. */
function isSubmissionNote(note) {
  const invitations = note?.invitations || (note?.invitation ? [note.invitation] : []);
  if (invitations.some((i) => APPARATUS_INVITATION_RE.test(String(i)))) return false;

  const raw = note?.content?.title;
  const title = (raw && typeof raw === "object" ? raw.value : raw) || "";
  return String(title).trim().length > 0;
}

export async function search(query, opts = {}, _config = {}) {
  const { limit = 10, signal } = opts;
  try {
    // Over-fetch: most hits for a typical query are reviewer reports, which are
    // dropped below. Without headroom a real paper rarely survives to the caller.
    const fetchLimit = Math.min(Math.max(limit * 4, 20), 100);
    const url = `${API}/notes/search?term=${encodeURIComponent(query)}&content=all&limit=${fetchLimit}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: signal || AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { papers: [], total: 0 };
    const data = await resp.json();
    const all = data.notes || [];
    const notes = all.filter(isSubmissionNote);

    // Most hits are reviewer notes. With credentials configured, trade them for
    // the submissions they discuss instead of discarding them.
    if (notes.length < limit) {
      const seen = new Set(notes.map((n) => n.id));
      const forums = [...new Set(
        all.filter((n) => !isSubmissionNote(n) && n.forum && !seen.has(n.forum)).map((n) => n.forum)
      )].slice(0, limit * 2);
      const resolved = await resolveForums(forums, signal);
      for (const note of resolved.values()) {
        if (!seen.has(note.id)) { seen.add(note.id); notes.push(note); }
      }
    }

    const papers = notes.map(fromOpenReview).slice(0, limit);
    return {
      papers,
      // Report what survived screening, not OpenReview's unfiltered note count.
      total: papers.length,
    };
  } catch (e) {
    return { papers: [], total: 0 };
  }
}
