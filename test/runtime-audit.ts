import type { Raw } from "../src/academic/types.ts";
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverName = process.argv[2] || 'academic-search';
const cfg = JSON.parse(execFileSync('/Users/phongdang/miniforge3/envs/ml/bin/python', ['-c', 'import tomllib,json; from pathlib import Path; c=tomllib.loads(Path("/Users/phongdang/.codex/config.toml").read_text()); print(json.dumps(c["mcp_servers"]["' + serverName + '"]))'], { encoding: 'utf8' }));
const client = new Client({ name: 'academic-audit', version: '1.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env }, stderr: 'pipe' });
const body = (r: Raw) => r.content?.filter((c: Raw) => c.type === 'text').map((c: Raw) => c.text).join('\n') || '';
async function call(name: Raw, args: Raw) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  assert.ok(!r.isError, name + ': ' + body(r).slice(0, 200));
  return r;
}
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const tool = (name: string) => tools.find(t => t.name === name)!;
  const local = serverName === 'academic-search';
  assert.ok(tool('academic_batch_format').inputSchema.properties![local ? 'styles' : 'style']);
  const citation = await call('academic_batch_format', local ? { paper_ids: ['1706.03762'], styles: ['bibtex', 'ris'] } : { paper_ids: ['1706.03762'], style: 'bibtex' });
  assert.match(body(citation), /Polosukhin/);
  const metadata = await call('academic_get_paper', {id:'1706.03762', ...(local ? {fetch_pdf:false} : {})});
  assert.match(body(metadata), /Polosukhin/);
  if (local) {
    if (process.argv.includes('--download')) {
      const downloaded = await call('academic_get_paper', {id:'1706.03762',fetch_pdf:false,download:true,save_dir:'/tmp/academic-mcp-audit-download'});
      assert.match(body(downloaded), /\*\*Downloaded\*\*/);
      const readAgain = await call('academic_get_paper', {id:'1706.03762',fetch_pdf:false});
      assert.ok(!body(readAgain).includes('**Downloaded**'), 'read-only cache must not contain a previous download action');
    }
    const pubmed = await call('academic_search', {query:'oral semaglutide cardiovascular outcomes high risk diabetes',sources:['pubmed'],limit:2});
    assert.match(body(pubmed), /Semaglutide/i);
    assert.ok(!body(pubmed).includes('Cardiovascular-outcomes-of-oral-incretin-based-drugs'));
    const vietnam = await call('academic_search', {query:'đái tháo đường',sources:['vjol'],limit:2});
    assert.match(body(vietnam), /vjol.info.vn/);
    const fulltext = await call('academic_fulltext', {id:'PMC7092803',max_chars:1500,save_dir:'/tmp/academic-mcp-audit-fulltext'});
    assert.match(body(fulltext), /Full text/);
    const hr = await call('academic_meta_analysis', { measure: 'HR', model: 'fixed', studies: ['A', 'B'].map(name => ({ name, estimate: 1, ciLow: .5, ciHigh: 2 })) });
    const interval = /1\.000 \(95% CI: ([\d.]+) - ([\d.]+)\)/.exec(body(hr));
    assert.ok(interval);
    assert.ok(Math.abs(Number(interval[1]) - Math.exp(-Math.log(2) / Math.sqrt(2))) < .001);
    assert.ok(Math.abs(Number(interval[2]) - Math.exp(Math.log(2) / Math.sqrt(2))) < .001);
    const missing = await client.callTool({ name: 'academic_meta_analysis', arguments: { mode: 'unanchored_maic', maic: { drugA: 'A', drugB: 'B' } } });
    assert.ok(missing.isError || /requires/.test(body(missing)));
    const rob = await call('academic_risk_of_bias', { assessments: [{ study: 'Unknown', d1: 'unclear', d2: 'unclear', d3: 'unclear', d4: 'unclear', d5: 'unclear' }] });
    assert.match(body(rob), /Overall.*|Unclear/);
    assert.ok(!body(rob).includes('**🟢 Low Risk**'));
    const inspect = await call('server', { mode: 'inspect', host: 'ai-proxy' });
    assert.ok(!body(inspect).includes("Can't open"));
  } else {
    assert.ok(!tool('academic_batch_format').description!.includes('Harvard'));
    assert.ok((tool('academic_search').inputSchema.properties!.sources as { enum: string[] }).enum.includes('ai_cs'));
    assert.ok((tool('academic_search').inputSchema.properties!.sort as { enum: string[] }).enum.includes('recency'));
    const status = await call('research_loop_status', {});
    assert.match(body(status), /ready/);
    const loopStatuses = (tool('research_loop_run').outputSchema!.properties!.status as { enum: string[] }).enum;
    for (const state of ['CITATION_AUDIT_FAILED', 'CITATION_AUDIT_SKIPPED', 'CITATION_AUDIT_WARNING']) {
      assert.ok(loopStatuses.includes(state), 'remote loop schema must disclose ' + state);
    }
    const audit = await call('research_verify_citations', { draft: 'Synthetic fixture: Dataset A contains ten records [E1].', evidence_bundle: 'Synthetic software-test fixture E1: Dataset A contains ten records.', claim_ledger: 'C1: Dataset A contains ten records, supported by E1.' });
    assert.match(body(audit), /ENTAILED/);
  }
  const results = await call('searxng_search', { query: '"Attention Is All You Need" arxiv', search_type: 'science', max_results: 5 });
  assert.ok(/arxiv|neurips/i.test(body(results)) && !/Google Docs: Sign-in/.test(body(results)));
  console.log(serverName + ': current schema, bibliography, primary runtime contracts verified');
} finally { await client.close(); }
