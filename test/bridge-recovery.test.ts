import type { Raw } from "../src/academic/types.ts";
import type { AddressInfo } from "node:net";
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

let initCount = 0;
let completed = 0;
let invalidCalls = 0;
let notifications = 0;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const message = JSON.parse(body);
  if (message.method === 'initialize') {
    initCount++;
    if (initCount > 1) await new Promise(resolve => setTimeout(resolve, 80));
    res.setHeader('mcp-session-id', `session-${initCount}`);
    res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{}}));
  } else if (message.id === undefined) {
    notifications++;
    res.writeHead(202).end();
  } else if (message.params?.name === 'late') {
    assert.equal(req.headers['mcp-session-id'], 'session-1');
    await new Promise(resolve => setTimeout(resolve, 250));
    // A late successful response must not revert a newly recovered session.
    res.setHeader('mcp-session-id', 'session-1');
    res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:'late'}));
  } else if (message.params?.name === 'invalid') {
    invalidCalls++;
    res.writeHead(400).end(JSON.stringify({error:{message:'Invalid tool arguments'}}));
  } else if (req.headers['mcp-session-id'] === 'session-1') {
    res.writeHead(404).end(JSON.stringify({error:{message:'Unknown session'}}));
  } else {
    assert.equal(req.headers['mcp-session-id'], 'session-2');
    completed++;
    res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:message.params.name}));
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const child = spawn(process.execPath, ['src/client-bridge.ts'], {
  env:{...process.env,PHONG_MCP_URL:`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,PHONG_MCP_API_KEY:'fixture-only'},
  stdio:['pipe','pipe','pipe'],
});
let buffer = '';
const received: Raw = [];
child.stdout.on('data', chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf('\n');
    if (index < 0) break;
    received.push(JSON.parse(buffer.slice(0,index)));
    buffer = buffer.slice(index+1);
  }
});
const send = (id: Raw,name: Raw) => child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name}})+'\n');
async function waitForCount(count: Raw) {
  const deadline = Date.now()+4000;
  while (received.length<count && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(received.length,count, 'expected exactly one response per request');
}
try {
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  send(2,'late');
  for (const id of [3,4,5]) send(id,'recover');
  await waitForCount(5);
  assert.equal(initCount,2,'one shared recovery, not one initialize per concurrent rejection');
  assert.equal(completed,3);
  assert.equal(notifications,2,'recovery must notify initialized');
  send(6,'after-late');
  await waitForCount(6);
  send(7,'invalid');
  await waitForCount(7);
  assert.equal(initCount,2,'invalid tool arguments must not reset the session');
  assert.equal(invalidCalls,1,'do not replay an invalid tool request');
  assert.deepEqual(received.map((r: Raw)=>r.id).sort((a: Raw,b: Raw)=>a-b),[1,2,3,4,5,6,7]);
  assert.ok(received.find((r: Raw)=>r.id===7).error);
  const missingEnv = {...process.env};
  delete missingEnv.PHONG_MCP_API_KEY;
  delete missingEnv.RESEARCH_MCP_TOKEN;
  const missing = spawnSync(process.execPath,['src/client-bridge.ts'],{env:missingEnv,encoding:'utf8'});
  assert.equal(missing.status,1);
  assert.equal(missing.stdout,'');
  assert.match(missing.stderr,/requires PHONG_MCP_API_KEY/);
  console.log('Bridge expiry single-flight, late-response isolation, invalid-input and missing-key contracts passed');
} finally {
  child.kill();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
