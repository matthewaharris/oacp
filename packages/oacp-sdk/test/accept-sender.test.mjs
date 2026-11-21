// RFC 005: a held message must reach the handlers once its sender is
// accepted. Run: npm test (builds first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OACPAgent } from '../dist/index.js';

const ME = '51c89079-f48a-426f-a54f-43e2eb28c47a';
const SENDER = '2d74ad67-76a9-4a0e-a43d-845ea678ddcf';
const OTHER = '9f78eac6-ab4d-4385-a9c9-049f844e6991';

const message = (id, sender, status, minute) => ({
  message_id: id,
  sender_agent_id: sender,
  recipient_agent_id: ME,
  message_type: 'task_request',
  payload: status === 'quarantined' ? {} : { action: 'review-pr' },
  delivery_status: status,
  timestamp: `2026-11-20T23:${minute}:00.000Z`,
});

/** An agent wired to a stand-in registry holding `inbox`. */
function setup(inbox, { inboxFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oacp-accept-'));
  const agent = new OACPAgent({
    name: 'test-agent',
    description: 'test',
    capabilities: [],
    keypairPath: join(dir, 'keypair.json'),
    apiBaseUrl: 'http://registry.test',
  });
  agent.agentId = ME;
  agent.registryToken = 'token';
  const handled = [];
  // Set handlers directly: on() would open a live push channel.
  agent.messageHandlers.set('task_request', [(m) => handled.push(m.message_id)]);

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/messages') {
      if (inboxFails) return json({ error: 'boom' }, 500);
      return json({ messages: inbox, total: inbox.length });
    }
    if (path === '/contacts/set') {
      const { sender_agent_id } = JSON.parse(init.body);
      let released = 0;
      for (const m of inbox) {
        if (m.sender_agent_id === sender_agent_id && m.delivery_status === 'quarantined') {
          m.delivery_status = 'delivered';
          m.payload = { action: 'review-pr' };
          released++;
        }
      }
      return json({ sender_agent_id, sender_name: 'matts-mac', status: 'accepted', released_messages: released });
    }
    return json({ error: 'not found' }, 404);
  };
  return { agent, handled };
}

test('accepting a sender hands their held messages to the handlers, oldest first', async () => {
  const { agent, handled } = setup([
    message('m2', SENDER, 'quarantined', '02'),
    message('m1', SENDER, 'quarantined', '01'),
  ]);
  const result = await agent.acceptSender(SENDER);
  assert.equal(result.released_messages, 2);
  assert.deepEqual(handled, ['m1', 'm2']);
});

test('a held message the agent was already pushed still runs after release', async () => {
  const inbox = [message('m1', SENDER, 'quarantined', '01')];
  const { agent, handled } = setup(inbox);
  await agent.fetchAndDispatch('m1'); // the push that arrived while held
  assert.deepEqual(handled, []);
  await agent.acceptSender(SENDER);
  assert.deepEqual(handled, ['m1']);
});

test('only the released messages run, and each runs once', async () => {
  const { agent, handled } = setup([
    message('old', SENDER, 'delivered', '00'),
    message('held', SENDER, 'quarantined', '01'),
    message('stranger', OTHER, 'quarantined', '02'),
  ]);
  await agent.acceptSender(SENDER);
  await agent.acceptSender(SENDER);
  await agent.fetchAndDispatch('held');
  assert.deepEqual(handled, ['held']);
});

test('accept still succeeds when the inbox cannot be read', async () => {
  const { agent, handled } = setup([message('m1', SENDER, 'quarantined', '01')], { inboxFails: true });
  const result = await agent.acceptSender(SENDER);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(handled, []);
});
