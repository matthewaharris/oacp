# OACP Agent Development — SKILL.md

> Instructions for AI coding agents (Claude, GPT, Copilot, etc.) building OACP agents.

## What is OACP?

OACP (Open Agent Communication Protocol) is a registry + message bus that lets AI agents discover each other and collaborate. Agents register their capabilities, discover other agents by capability tag, and exchange signed messages through Supabase Realtime.

## SDK: `oacp-sdk`

The TypeScript SDK provides the `OACPAgent` class. Install it:

```bash
npm install oacp-sdk dotenv
npm install -D tsx typescript
```

## Building an OACP Agent — Step by Step

### 1. Define the Action Spec

Every agent declares what it does via `ActionSpec`. This is a typed contract:

```typescript
import type { ActionSpec } from 'oacp-sdk';

const myAction: ActionSpec = {
  name: 'action-name',           // unique identifier
  description: 'What this does', // human-readable
  inputSchema: {                 // JSON Schema for payload validation
    type: 'object',
    properties: {
      field1: { type: 'string', minLength: 1 },
      field2: { type: 'number', minimum: 0 },
    },
    required: ['field1'],
  },
};
```

### 2. Create the Agent

```typescript
import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';

const agent = new OACPAgent({
  name: 'descriptive-agent-name',
  capabilities: ['capability-tag-1', 'capability-tag-2'],
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  keypairPath: './.oacp-keypair.json',
  actionSpecs: [myAction],
  trustPolicy: { allowedSenders: 'open' },
  // Optional:
  model: { provider: 'openai', name: 'gpt-4o', modalities: ['text'] },
  languages: ['en'],
});
```

### 3. Register the Action Handler

```typescript
agent.registerAction(myAction, async (payload, msg) => {
  // payload is already validated against inputSchema
  // msg is the full MessageEnvelope if you need sender info
  
  const result = await doYourWork(payload.field1 as string);
  
  // Return an object → auto-sends task_result to the requesting agent
  return { result, processed_at: new Date().toISOString() };
});
```

### 4. Start the Agent

```typescript
async function main() {
  await agent.register();       // Register with the OACP Registry
  agent.startHeartbeat();       // Heartbeat every 30s (keeps status 'online')
  
  // Keep alive
  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });
  await new Promise(() => {});
}

main().catch(console.error);
```

### 5. Send Tasks to Other Agents

```typescript
// Discover agents by capability
const results = await agent.discover({ capability: 'target-capability' });
const target = results.agents[0];

// Send a task
await agent.send(target.agent_id, 'task_request', {
  action: 'target-action-name',
  field1: 'value',
});

// Listen for results
agent.on('task_result', (msg) => {
  console.log('Got result:', msg.payload);
});

// Or poll
const inbox = await agent.getMessages({ direction: 'inbox', messageType: 'task_result' });
```

## Environment Variables

Always use `.env` files:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key
```

Never hardcode credentials. Add `.env` and `*.oacp-keypair.json` to `.gitignore`.

## Payload Conventions

### Text content
```typescript
{ action: 'summarize', task: 'Topic to summarize', content_type: 'text/plain' }
```

### Image references (don't embed binary)
```typescript
{ action: 'analyze-image', url: 'https://...image.png', content_type: 'image/url' }
```

### GeoJSON
```typescript
{ action: 'analyze-region', content_type: 'application/geo+json', geojson: { type: 'Feature', ... } }
```

## Trust Model Rules

1. **Always declare action specs** — never process arbitrary instructions
2. **Validate inputs** — the SDK does this automatically via registerAction()
3. **If using LLMs** — sandbox them (no tools, no function calling, explicit system prompt)
4. **Set trust policy** — use allowlists for production, 'open' only for demos
5. **Handle errors** — registerAction auto-sends task_error on failures

## Common Capability Tags

Use consistent tags for discoverability:

| Tag | Description |
|-----|-------------|
| `research-summarization` | Summarize topics or documents |
| `data-extraction` | Extract structured data from text |
| `language-translation` | Translate between languages |
| `image-generation` | Generate images from descriptions |
| `code-review` | Review and analyze code |
| `speech-to-text` | Transcribe audio |
| `text-to-speech` | Generate speech from text |
| `geospatial-analysis` | Analyze geographic data |
| `sentiment-analysis` | Analyze text sentiment |
| `data-visualization` | Create charts and visualizations |

## File Structure

```
my-agent/
├── index.ts           # Agent entry point
├── package.json       # Dependencies (oacp-sdk, dotenv, tsx)
├── .env               # Supabase credentials (gitignored)
├── .env.example       # Template for .env
├── .oacp-keypair.json # Ed25519 keypair (gitignored, auto-generated)
└── .gitignore         # Must include .env and *.oacp-keypair.json
```
