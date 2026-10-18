import type { Raw } from "../src/academic/types.ts";
import type { AddressInfo } from "node:net";
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const m = JSON.parse(body);
  if (m.method === 'initialize') {
    res.setHeader('mcp-session-id', 'fixture-session');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }));
  } else if (!m.id) { res.writeHead(202).end(); }
  else {
    assert.equal(req.headers['mcp-session-id'], 'fixture-session');
    if (m.params?.name === 'slow') await new Promise(r => setTimeout(r, 300));
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.params?.name }));
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const child = spawn(process.execPath, ['src/client-bridge.ts'], { env: { ...process.env, PHONG_MCP_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, PHONG_MCP_API_KEY: 'fixture-only' }, stdio: ['pipe', 'pipe', 'pipe'] });
try {
  let output = '';
  const received: Raw = [];
  child.stdout.on('data', b => {
    output += b;
    for (;;) {
      const i = output.indexOf('\n'); if (i < 0) break;
      received.push(JSON.parse(output.slice(0, i))); output = output.slice(i + 1);
    }
  });
  for (const m of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fast' } }]) child.stdin.write(JSON.stringify(m) + '\n');
  const deadline = Date.now() + 3000;
  while (received.length < 3 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(received.map((m: Raw) => m.id), [1, 3, 2]);
  console.log('Bridge concurrent calls preserve IDs and session initialization');
} finally { child.kill(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
