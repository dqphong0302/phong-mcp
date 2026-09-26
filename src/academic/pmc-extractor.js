/**
 * PubMed Central Full-Text XML & Table Extractor
 */

export function normalizePmcId(id) {
  const m = String(id || "").match(/PMC\d+/i);
  return m ? m[0].toUpperCase() : (String(id || "").match(/^\d+$/) ? `PMC${id}` : null);
}

export async function fetchPmcArticleTables(pmcId, _config = {}) {
  const normId = normalizePmcId(pmcId);
  if (!normId) return { error: `Invalid PMCID: ${pmcId}` };

  try {
    const rawNum = normId.replace(/^PMC/i, "");
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${rawNum}&retmode=xml`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "academic-search-mcp/2.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return { error: `PMC Fetch HTTP ${resp.status}` };
    const xml = await resp.text();

    const tables = [];
    const tableRe = /<table-wrap[^>]*>([\s\S]*?)<\/table-wrap>/g;
    let match;
    let idx = 1;
    while ((match = tableRe.exec(xml)) !== null && idx <= 10) {
      const block = match[1];
      const label = /<label>(.*?)<\/label>/.exec(block)?.[1] || `Table ${idx}`;
      const caption = /<caption>([\s\S]*?)<\/caption>/.exec(block)?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
      tables.push({
        table_index: idx++,
        label,
        caption,
        xml_length: block.length,
      });
    }

    return {
      pmcid: normId,
      total_tables: tables.length,
      tables,
    };
  } catch (err) {
    return { error: `Failed to extract PMC tables: ${err.message}` };
  }
}
