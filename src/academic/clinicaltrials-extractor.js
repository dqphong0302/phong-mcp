/**
 * ClinicalTrials.gov v2 Study Extractor
 */

export function normalizeNctId(id) {
  const m = String(id || "").match(/NCT\d{8}/i);
  return m ? m[0].toUpperCase() : null;
}

export async function fetchClinicalTrialResults(nctId, _config = {}) {
  const normId = normalizeNctId(nctId);
  if (!normId) return { error: `Invalid NCT identifier: ${nctId}` };

  try {
    const url = `https://clinicaltrials.gov/api/v2/studies/${normId}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { error: `ClinicalTrials API error: HTTP ${resp.status}` };
    const data = await resp.json();
    const protocol = data.protocolSection || {};
    const results = data.resultsSection || {};

    return {
      nctId: normId,
      title: protocol.identificationModule?.briefTitle || "",
      phase: protocol.designModule?.phases?.join(", ") || "N/A",
      status: protocol.statusModule?.overallStatus || "Unknown",
      conditions: protocol.conditionsModule?.conditions || [],
      interventions: protocol.armsInterventionsModule?.interventions?.map((i) => i.name) || [],
      primaryOutcomes: protocol.outcomesModule?.primaryOutcomes || [],
      hasResults: Boolean(results.outcomeMeasuresModule),
    };
  } catch (err) {
    return { error: `Failed to fetch ClinicalTrials.gov record: ${err.message}` };
  }
}
