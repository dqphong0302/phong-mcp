import type { Raw } from "../src/academic/types.ts";
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// Existing client configurations are read privately; no keys/env are logged.
const configs=JSON.parse(execFileSync('/Users/phongdang/miniforge3/envs/ml/bin/python',['-c',
  'import json,tomllib; from pathlib import Path; print(json.dumps([{"name":"Codex","config":tomllib.loads(Path("/Users/phongdang/.codex/config.toml").read_text())["mcp_servers"]["academic-research"]},{"name":"Claude Code","config":json.loads(Path("/Users/phongdang/.claude.json").read_text())["mcpServers"]["research-loop-mcp"]},{"name":"Antigravity","config":json.loads(Path("/Users/phongdang/.gemini/antigravity-ide/mcp_config.json").read_text())["mcpServers"]["research-loop-mcp"]}]))'
],{encoding:'utf8'}));
assert.ok(configs.every((c: Raw)=>c.config.env.PHONG_MCP_API_KEY===configs[0].config.env.PHONG_MCP_API_KEY));
for(const {name,config} of configs){
  const client=new Client({name:'rotation-client-check',version:'1'},{capabilities:{}});
  const useDefault=process.argv.includes('--default');
  const env={...process.env,...config.env};
  if(!useDefault) env.PHONG_MCP_URL='https://ai-proxy.phongdang.io.vn/phong-mcp/mcp';
  const transport=new StdioClientTransport({command:config.command,args:config.args,env,stderr:'pipe'});
  try{
    await client.connect(transport);
    const list=await client.listTools();
    assert.ok(list.tools.some(t=>t.name==='research_loop_status'));
    const r=await client.callTool({name:'research_loop_status',arguments:{}},undefined,{timeout:30000});
    assert.ok(!r.isError);
    const body=(r.content as Array<{ type: string; text: string }>).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    assert.match(body,/ready/);
    console.log(name+': configured bridge with rotated key passed '+(useDefault?'default authenticated gateway':'WAN')+' initialize/list/status');
  }finally{await client.close();}
}
