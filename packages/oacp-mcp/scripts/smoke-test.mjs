#!/usr/bin/env node
/**
 * Smoke test: run the MCP server on stdio against a local mock OACP registry
 * and exercise the full flow — initialize, tools/list, status, discover,
 * register, send, wait_for_reply (reply delivered mid-poll), check_inbox.
 * Exits non-zero on any failure. No live infrastructure required.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const keypairPath = path.join(root, '.smoke-keypair.json');

// ------------------------------------------------------------
// Mock OACP registry
// ------------------------------------------------------------
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const PEER_ID = '22222222-2222-4222-8222-222222222222';
let inboxPolls = 0;
const outbox = [];

const registry = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const body = req.method === 'POST' ? await readJson(req) : null;
  const send = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (url.pathname.endsWith('/register')) {
    return send(200, {
      agent_id: AGENT_ID,
      registry_token: 'mock-token',
      created_at: new Date().toISOString(),
    });
  }
  if (url.pathname.endsWith('/heartbeat')) {
    return send(200, { agent_id: AGENT_ID, status: 'online', last_seen_at: new Date().toISOString() });
  }
  if (url.pathname.endsWith('/discover')) {
    return send(200, {
      agents: [
        {
          agent_id: PEER_ID,
          name: 'mock-peer',
          capabilities: ['echo'],
          status: 'online',
          public_key: 'ab'.repeat(32),
          protocols_supported: ['oacp'],
          metadata: { action_specs: [{ name: 'echo', description: 'Echo a message' }] },
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    });
  }
  if (url.pathname.endsWith('/messages/send')) {
    outbox.push(body);
    return send(200, { message_id: '33333333-3333-4333-8333-333333333333' });
  }
  if (url.pathname.endsWith('/messages')) {
    const direction = url.searchParams.get('direction') || 'inbox';
    if (direction === 'outbox') {
      return send(200, { messages: outbox.map(asEnvelope), total: outbox.length });
    }
    // Inbox: empty on the first poll, then deliver the peer's reply.
    inboxPolls++;
    if (inboxPolls < 2) return send(200, { messages: [], total: 0 });
    return send(200, {
      messages: [
        {
          message_id: '44444444-4444-4444-8444-444444444444',
          sender_agent_id: PEER_ID,
          recipient_agent_id: AGENT_ID,
          message_type: 'task_result',
          payload: { echoed: 'hello from mock peer' },
          signature: 'cd'.repeat(64),
          correlation_id: url.searchParams.get('correlation_id') || undefined,
          timestamp: new Date().toISOString(),
        },
      ],
      total: 1,
    });
  }
  send(404, { error: `mock registry: unknown path ${url.pathname}` });
});

function asEnvelope(b, i) {
  return {
    message_id: `55555555-5555-4555-8555-55555555555${i}`,
    ...b,
    timestamp: new Date().toISOString(),
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : null));
  });
}

await new Promise((r) => registry.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${registry.address().port}/oacp`;
console.error(`mock registry on ${apiBase}`);

// ------------------------------------------------------------
// MCP client over stdio
// ------------------------------------------------------------
const server = spawn('node', [path.join(root, 'dist', 'index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, OACP_KEYPAIR_PATH: keypairPath, OACP_API_BASE_URL: apiBase },
});

let buffer = '';
const pending = new Map();
let nextId = 1;

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 30_000);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function callTool(name, args) {
  const res = await request('tools/call', { name, arguments: args });
  if (res.error) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
  const body = JSON.parse(res.result.content[0].text);
  if (res.result.isError) throw new Error(`${name} errored: ${body.error}`);
  return body;
}

function cleanup() {
  server.kill();
  registry.close();
  fs.rmSync(keypairPath, { force: true });
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  cleanup();
  process.exit(1);
}

try {
  const init = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  });
  if (init.result?.serverInfo?.name !== 'oacp') fail('initialize: bad serverInfo');
  notify('notifications/initialized', {});
  console.error('✓ initialize');

  const tools = await request('tools/list', {});
  const names = tools.result.tools.map((t) => t.name).sort();
  const expected = [
    'oacp_check_inbox',
    'oacp_discover',
    'oacp_register',
    'oacp_send',
    'oacp_status',
    'oacp_thread_control',
    'oacp_wait_for_reply',
  ];
  for (const t of expected) if (!names.includes(t)) fail(`tools/list missing ${t}`);
  console.error(`✓ tools/list (${names.length} tools)`);

  const prompts = await request('prompts/list', {});
  const pnames = prompts.result.prompts.map((p) => p.name).sort();
  if (!pnames.includes('listen') || !pnames.includes('chat')) fail(`prompts/list missing listen/chat: ${pnames.join(',')}`);
  const listen = await request('prompts/get', { name: 'listen', arguments: {} });
  if (!listen.result.messages?.[0]?.content?.text?.includes('oacp_wait_for_reply')) fail('listen prompt: bad content');
  console.error(`✓ prompts/list (${pnames.length} prompts) + listen renders`);

  const status = await callTool('oacp_status', {});
  if (status.registered !== false) fail('oacp_status: expected unregistered');
  console.error('✓ oacp_status (unregistered)');

  const discover = await callTool('oacp_discover', { capability: 'echo' });
  if (discover.total !== 1 || discover.agents[0].agent_id !== PEER_ID) fail('oacp_discover: bad result');
  console.error('✓ oacp_discover');

  const reg = await callTool('oacp_register', {
    name: 'smoke-agent',
    capabilities: ['testing'],
  });
  if (reg.agent_id !== AGENT_ID) fail('oacp_register: bad agent_id');
  console.error(`✓ oacp_register (${reg.agent_id})`);

  const status2 = await callTool('oacp_status', {});
  if (status2.registered !== true || status2.agent_id !== AGENT_ID) fail('oacp_status: expected registered');
  console.error('✓ oacp_status (registered)');

  const sent = await callTool('oacp_send', {
    recipient_agent_id: PEER_ID,
    message_type: 'task_request',
    payload: { action: 'echo', text: 'hello' },
  });
  if (!sent.message_id) fail('oacp_send: no message_id');
  if (outbox.length !== 1 || !outbox[0].signature) fail('oacp_send: registry did not receive signed message');
  console.error(`✓ oacp_send (signed, correlation ${sent.correlation_id})`);

  const reply = await callTool('oacp_wait_for_reply', {
    correlation_id: sent.correlation_id,
    timeout_seconds: 15,
  });
  if (reply.timed_out !== false) fail('oacp_wait_for_reply: timed out');
  if (reply.messages[0].payload.echoed !== 'hello from mock peer') fail('oacp_wait_for_reply: bad payload');
  console.error('✓ oacp_wait_for_reply (reply arrived on 2nd poll)');

  const inbox = await callTool('oacp_check_inbox', { direction: 'outbox' });
  if (inbox.total !== 1) fail('oacp_check_inbox: expected 1 outbox message');
  console.error('✓ oacp_check_inbox (outbox)');

  console.error('\nAll smoke tests passed.');
  cleanup();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
