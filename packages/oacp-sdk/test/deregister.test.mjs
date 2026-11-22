// RFC 009: an agent removes itself from the registry.
// Run: npm test (builds first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OACPAgent, canonicalizeDeregistration, verifySignature } from '../dist/index.js';

const ME = '51c89079-f48a-426f-a54f-43e2eb28c47a';

/** An agent wired to a stand-in registry that answers `reply`. */
function setup(reply) {
  const dir = mkdtempSync(join(tmpdir(), 'oacp-dereg-'));
  const keypairPath = join(dir, 'keypair.json');
  const agent = new OACPAgent({
    name: 'test-agent',
    description: 'test',
    capabilities: [],
    keypairPath,
    apiBaseUrl: 'http://registry.test',
  });
  agent.agentId = ME;
  agent.registryToken = 'token';
  agent.messageHandlers.set('task_request', [() => {}]);

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { agent, calls, keypairPath, restore: () => (globalThis.fetch = realFetch) };
}

test('the canonical string has a fixed key order and no whitespace', () => {
  assert.equal(
    canonicalizeDeregistration(ME, '2026-11-21T18:04:11.000Z'),
    `{"action":"deregister","agent_id":"${ME}","timestamp":"2026-11-21T18:04:11.000Z"}`,
  );
});

test('deregister sends the token and a signature the registry can verify', async () => {
  const { agent, calls, restore } = setup({ status: 200, body: { deregistered: true, outcome: 'deleted' } });
  try {
    const publicKey = agent.keypair.publicKey;
    const result = await agent.deregister();
    assert.deepEqual(result, { outcome: 'deleted' });

    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, 'http://registry.test/agents/deregister');
    assert.equal(init.headers.Authorization, 'Bearer token');
    assert.equal(body.agent_id, ME);
    assert.ok(Math.abs(Date.now() - Date.parse(body.timestamp)) < 5000);
    assert.ok(verifySignature(body.signature, canonicalizeDeregistration(ME, body.timestamp), publicKey));
  } finally {
    restore();
  }
});

test('after deregistering, the agent holds no credentials but keeps its key', async () => {
  const { agent, keypairPath, restore } = setup({
    status: 200,
    body: { deregistered: true, outcome: 'tombstoned' },
  });
  try {
    assert.deepEqual(await agent.deregister(), { outcome: 'tombstoned' });
    assert.equal(agent.agentId, null);
    assert.equal(agent.registryToken, null);
    assert.equal(agent.messageHandlers.size, 0);
    assert.ok(existsSync(keypairPath), 'the key pair file is left in place');
    await assert.rejects(agent.deregister(), /must be registered first/);
  } finally {
    restore();
  }
});

test('a refusal leaves the agent registered', async () => {
  const { agent, restore } = setup({ status: 409, body: { error: 'A held escrow must be settled' } });
  try {
    await assert.rejects(agent.deregister(), /409/);
    assert.equal(agent.agentId, ME);
    assert.equal(agent.registryToken, 'token');
    assert.equal(agent.messageHandlers.size, 1);
  } finally {
    restore();
  }
});

test('an unregistered agent cannot deregister', async () => {
  const { agent, calls, restore } = setup({ status: 200, body: {} });
  try {
    agent.agentId = null;
    await assert.rejects(agent.deregister(), /must be registered first/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});
