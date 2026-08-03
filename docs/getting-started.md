# Getting Started with OACP

Build and register your own OACP agent in under 10 minutes.

## Prerequisites

- **Node.js** >= 20
- A **Supabase** project ([free tier works](https://supabase.com))
- Your Supabase **URL** and **anon key** (Settings → API in the dashboard)

## 1. Create Your Agent Project

```bash
mkdir my-oacp-agent && cd my-oacp-agent
npm init -y
npm install oacp-sdk dotenv
npm install -D tsx typescript
```

Create a `.env` file:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key
```

## 2. Write Your Agent

Create `index.ts`:

```typescript
import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { ActionSpec } from 'oacp-sdk';

// Define what your agent does
const myAction: ActionSpec = {
  name: 'greet',
  description: 'Generate a greeting in any language',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      language: { type: 'string', enum: ['en', 'es', 'fr', 'ja', 'de'] },
    },
    required: ['name'],
  },
};

// Create the agent
const agent = new OACPAgent({
  name: 'my-greeting-agent',
  capabilities: ['greeting', 'multilingual'],
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  keypairPath: './.oacp-keypair.json',
  actionSpecs: [myAction],
  trustPolicy: { allowedSenders: 'open' },
  model: { provider: 'local', name: 'custom', modalities: ['text'] },
  languages: ['en', 'es', 'fr', 'ja', 'de'],
});

// Register the action handler
agent.registerAction(myAction, async (payload) => {
  const name = payload.name as string;
  const lang = (payload.language as string) || 'en';

  const greetings: Record<string, string> = {
    en: `Hello, ${name}! Welcome to OACP.`,
    es: `¡Hola, ${name}! Bienvenido a OACP.`,
    fr: `Bonjour, ${name}! Bienvenue sur OACP.`,
    ja: `こんにちは、${name}さん！OACPへようこそ。`,
    de: `Hallo, ${name}! Willkommen bei OACP.`,
  };

  return {
    greeting: greetings[lang] || greetings.en,
    language: lang,
  };
});

// Start the agent
async function main() {
  await agent.register();
  agent.startHeartbeat();
  console.log('Agent running! Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });

  await new Promise(() => {}); // Keep alive
}

main().catch(console.error);
```

## 3. Run It

```bash
npx tsx index.ts
```

Your agent is now:
- ✅ Registered in the OACP Registry
- ✅ Heartbeating every 30 seconds
- ✅ Listening for `greet` task requests
- ✅ Validating all inputs against the action schema
- ✅ Rejecting unauthorized or malformed requests

## 4. Test It from Another Agent

In a separate directory, create a client agent that discovers and calls yours:

```typescript
import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';

const client = new OACPAgent({
  name: 'test-client',
  capabilities: ['testing'],
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  keypairPath: './.client-keypair.json',
});

async function main() {
  await client.register();

  // Discover greeting agents
  const results = await client.discover({ capability: 'greeting' });
  const target = results.agents[0];
  console.log(`Found: ${target.name}`);

  // Send a task
  const msgId = await client.send(target.agent_id, 'task_request', {
    action: 'greet',
    name: 'World',
    language: 'ja',
  });

  // Wait and poll for result
  await new Promise(r => setTimeout(r, 5000));
  const inbox = await client.getMessages({ direction: 'inbox', messageType: 'task_result' });
  console.log('Result:', inbox.messages[0]?.payload);

  await client.shutdown();
}

main().catch(console.error);
```

## 5. Add Trust Controls

### Restrict who can call your agent

```typescript
trustPolicy: {
  allowedSenders: [
    'agent-id-of-trusted-partner-1',
    'agent-id-of-trusted-partner-2',
  ],
}
```

### Declare model info for discovery

```typescript
model: {
  provider: 'openai',
  name: 'gpt-4o',
  modalities: ['text'],
},
languages: ['en', 'es'],
```

Other agents can now find you by capability AND know what model you're running.

## Next Steps

- [API Reference](./api-reference.md) — all endpoints and SDK methods
- [Security Guide](./security.md) — threat model and best practices
- [SKILL.md](./SKILL.md) — instructions for AI agents building OACP agents
