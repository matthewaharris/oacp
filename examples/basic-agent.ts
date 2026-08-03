/**
 * OACP Basic Agent Example
 *
 * Demonstrates how to use the oacp-sdk to:
 * 1. Create an agent with Ed25519 identity
 * 2. Register with the OACP Registry
 * 3. Start automatic heartbeating
 * 4. Discover other agents by capability
 *
 * Prerequisites:
 *   - Supabase project running (local or hosted)
 *   - Environment variables: SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Usage:
 *   npx ts-node examples/basic-agent.ts
 */

import { OACPAgent } from '../packages/oacp-sdk/src/index.js';

async function main() {
  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
    console.error('Set them in .env or export them before running.');
    process.exit(1);
  }

  // Create an agent
  const agent = new OACPAgent({
    name: 'example-research-agent',
    capabilities: ['research-summarization', 'web-search'],
    ownerHandle: 'demo-user',
    description: 'An example agent that demonstrates OACP SDK usage',
    supabaseUrl,
    supabaseAnonKey,
    keypairPath: './.oacp-example-keypair.json',
  });

  try {
    // Register with the registry
    console.log('\n--- Registering agent ---');
    const agentId = await agent.register();
    console.log(`Agent ID: ${agentId}`);
    console.log(`Public Key: ${agent.getPublicKey()}`);

    // Start heartbeat
    console.log('\n--- Starting heartbeat ---');
    agent.startHeartbeat(10_000); // 10s for demo purposes

    // Wait a moment for heartbeat to settle
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Discover agents
    console.log('\n--- Discovering agents ---');
    const results = await agent.discover({ status: 'online' });
    console.log(`Found ${results.total} online agent(s):`);
    for (const a of results.agents) {
      console.log(`  - ${a.name} (${a.agent_id.substring(0, 8)}...) [${a.capabilities.join(', ')}]`);
    }

    // Discover by capability
    console.log('\n--- Discovering by capability ---');
    const specific = await agent.discover({ capability: 'research-summarization' });
    console.log(`Found ${specific.total} agent(s) with 'research-summarization'`);

    // Test signing
    console.log('\n--- Testing message signing ---');
    const message = 'Hello, OACP!';
    const signature = agent.sign(message);
    const valid = agent.verify(signature, message, agent.getPublicKey());
    console.log(`Signed: ${signature.substring(0, 32)}...`);
    console.log(`Verified: ${valid}`);

    // Keep running for 10 seconds to show heartbeat
    console.log('\n--- Running for 10 seconds (watch heartbeats) ---');
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    // Shutdown
    await agent.shutdown();
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err);
    await agent.shutdown();
    process.exit(1);
  }
}

main();
