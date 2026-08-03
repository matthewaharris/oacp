/**
 * OACP Two-Agent Demo
 *
 * Demonstrates the full OACP flow from PRD Section 7:
 * 1. Agent A (research) registers with 'research-summarization' capability
 * 2. Agent B (extraction) registers with 'data-extraction' capability
 * 3. Agent B discovers Agent A via capability search
 * 4. Agent B sends a task_request to Agent A
 * 5. Agent A receives the task, processes it, sends task_result back
 * 6. Agent B receives the result
 *
 * Prerequisites:
 *   - Supabase project running (local or hosted)
 *   - SUPABASE_URL and SUPABASE_ANON_KEY set
 *
 * Usage:
 *   npx ts-node examples/two-agents.ts
 */

import { OACPAgent } from '../packages/oacp-sdk/src/index.js';
import type { MessageEnvelope } from '../packages/oacp-sdk/src/types.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== OACP Two-Agent Demo ===\n');

  // ── Step 1: Create Agent A (Research Summarization) ──
  console.log('--- Step 1: Creating Agent A (research) ---');
  const agentA = new OACPAgent({
    name: 'matts-research-agent',
    capabilities: ['research-summarization'],
    ownerHandle: 'matt',
    description: 'Summarizes research topics on demand',
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    keypairPath: './.oacp-agent-a.json',
    heartbeatIntervalMs: 15_000,
  });

  const agentAId = await agentA.register();
  agentA.startHeartbeat();
  console.log(`Agent A registered: ${agentAId}\n`);

  // ── Step 2: Create Agent B (Data Extraction) ──
  console.log('--- Step 2: Creating Agent B (extraction) ---');
  const agentB = new OACPAgent({
    name: 'friends-extraction-agent',
    capabilities: ['data-extraction'],
    ownerHandle: 'friend',
    description: 'Extracts structured data from text',
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    keypairPath: './.oacp-agent-b.json',
    heartbeatIntervalMs: 15_000,
  });

  const agentBId = await agentB.register();
  agentB.startHeartbeat();
  console.log(`Agent B registered: ${agentBId}\n`);

  // ── Step 3: Agent B discovers Agent A ──
  console.log('--- Step 3: Agent B discovers Agent A ---');
  const results = await agentB.discover({ capability: 'research-summarization' });
  console.log(`Found ${results.total} agent(s) with 'research-summarization':`);

  const targetAgent = results.agents.find((a) => a.agent_id === agentAId);
  if (!targetAgent) {
    console.error('Agent A not found in discovery results!');
    await cleanup(agentA, agentB);
    return;
  }
  console.log(`  → ${targetAgent.name} (${targetAgent.agent_id.substring(0, 8)}...)\n`);

  // ── Step 4: Set up Agent A's task handler ──
  console.log('--- Step 4: Agent A listens for tasks ---');
  const correlationId = crypto.randomUUID();

  agentA.on('task_request', async (msg: MessageEnvelope) => {
    console.log(`\n[Agent A] Received task_request: "${(msg.payload as any).task}"`);

    // Simulate processing
    console.log('[Agent A] Processing research task...');
    await sleep(2000);

    // Send result back
    const summary = `Summary of "${(msg.payload as any).task}": ` +
      'The OACP protocol fills a gap in the agent interoperability landscape by providing ' +
      'a registry-based discovery and relay mechanism for agents that cannot expose public endpoints. ' +
      'It complements A2A (Google) and MCP (Anthropic) by enabling peer-to-peer agent communication ' +
      'through a Supabase-powered message bus with Ed25519 identity verification.';

    await agentA.send(msg.sender_agent_id, 'task_result', {
      summary,
      word_count: summary.split(' ').length,
      source: 'oacp-research-agent',
    }, { correlationId: msg.correlation_id });

    console.log('[Agent A] Sent task_result back\n');
  });

  // ── Step 5: Agent B sends task to Agent A ──
  console.log('--- Step 5: Agent B sends task_request to Agent A ---');
  const messageId = await agentB.send(
    agentAId,
    'task_request',
    {
      task: 'Summarize the current state of open agent communication protocols in under 300 words',
      priority: 'normal',
    },
    { correlationId },
  );
  console.log(`Task request sent (message_id: ${messageId})\n`);

  // ── Step 6: Wait for processing and check results ──
  console.log('--- Step 6: Waiting for result ---');
  await sleep(5000);

  // Poll for the result
  const inbox = await agentB.getMessages({
    direction: 'inbox',
    messageType: 'task_result',
    correlationId,
  });

  if (inbox.messages.length > 0) {
    const result = inbox.messages[0];
    console.log('\n=== Task Result Received ===');
    console.log(`From: ${result.sender_agent_id?.substring(0, 8)}...`);
    console.log(`Summary: ${(result.payload as any).summary?.substring(0, 100)}...`);
    console.log(`Word count: ${(result.payload as any).word_count}`);
  } else {
    console.log('(Result not yet available via polling — may arrive via Realtime)');
  }

  // ── Cleanup ──
  console.log('\n--- Cleanup ---');
  await cleanup(agentA, agentB);
  console.log('\n=== Demo Complete ===');
}

async function cleanup(agentA: OACPAgent, agentB: OACPAgent) {
  await agentA.shutdown();
  await agentB.shutdown();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
