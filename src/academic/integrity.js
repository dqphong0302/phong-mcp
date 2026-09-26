/**
 * Research-integrity checks.
 *
 * Flags retracted / withdrawn works so a citation is never emitted silently.
 * Two keyless sources are consulted in parallel:
 *   - OpenAlex  → `is_retracted` on the work record
 *   - Crossref  → an `update-to` relation whose type is a retraction/withdrawal
 *
 * Design notes:
 *  - NEVER throws. A network failure returns `{ retracted: false }` so a
 *    transient outage can never hide a paper from the caller.
 *  - Results are memoised for the process lifetime: the retraction status of a
 *    DOI does not change between two calls in the same search.
 */

const TIMEOUT_MS = 6000;
const CACHE_MAX = 5000;

/** doi → { retracted, notice } */
const _cache = new Map();

/** Crossref `update-to` types that mean "do not cite this as-is". */
const RETRACTION_TYPES = new Set([
  "retraction",
  "withdrawal",
  "removal",
  "partial_retraction",
]);

function normaliseDoi(doi) {
  return String(doi || "")
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
}

async function jsonGet(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function checkOpenAlex(doi) {
  const mail = process.env.UNPAYWALL_EMAIL || "";
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
  const work = await jsonGet(url);
  if (!work) return null;
  if (work.is_retracted === true) {
    return { retracted: true, notice: "OpenAlex: work flagged as retracted" };
  }
  return { retracted: false };
}

async function checkCrossref(doi) {
  const mail = process.env.UNPAYWALL_EMAIL || "";
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
  const data = await jsonGet(url);
  const msg = data?.message;
  if (!msg) return null;

  const updates = Array.isArray(msg["update-to"]) ? msg["update-to"] : [];
  const hit = updates.find((u) =>
    RETRACTION_TYPES.has(String(u?.type || "").toLowerCase().replace(/[\s-]/g, "_"))
  );
  if (hit) {
    const when = hit["updated"]?.["date-parts"]?.[0]?.join("-") || null;
    return {
      retracted: true,
      notice: `Crossref: ${hit.type}${when ? ` (${when})` : ""}${hit.DOI ? ` — notice DOI ${hit.DOI}` : ""}`,
    };
  }

  // Crossref also types the *notice itself* as a retraction record.
  if (String(msg.type || "").toLowerCase() === "retraction") {
    return { retracted: true, notice: "Crossref: record type is 'retraction'" };
  }
  return { retracted: false };
}

/**
 * Check whether a DOI has been retracted or withdrawn.
 *
 * @param {string} doi
 * @returns {Promise<{ retracted: boolean, notice: string|null }>}
 */
export async function checkRetraction(doi) {
  const key = normaliseDoi(doi);
  if (!key || !/^10\.\d{4,}\//.test(key)) return { retracted: false, notice: null };
  if (_cache.has(key)) return _cache.get(key);

  const [oa, cr] = await Promise.all([
    checkOpenAlex(key).catch(() => null),
    checkCrossref(key).catch(() => null),
  ]);

  const flagged = [oa, cr].find((r) => r?.retracted === true);
  const result = flagged
    ? { retracted: true, notice: flagged.notice || null }
    : { retracted: false, notice: null };

  if (_cache.size >= CACHE_MAX) _cache.clear();
  _cache.set(key, result);
  return result;
}

export default { checkRetraction };
