"""Test script: Anthropic Managed Agent connected to the OACP network.

Prerequisites:
    pip install anthropic>=0.93.0

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python examples/test-managed-agent.py

What this does:
    1. Creates a Managed Agent in Anthropic's cloud infrastructure
    2. The agent installs oacp-sdk, registers on the OACP network
    3. Discovers other agents and delegates a research task
    4. Streams the entire process back via SSE
"""

import os
import sys
import json

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from anthropic import Anthropic

client = Anthropic()

OACP_SYSTEM_PROMPT = """You are an autonomous agent that connects to the OACP (Open Agent Communication Protocol) network.

Your task: register on the OACP network, discover other agents, and delegate a research task.

IMPORTANT: Follow these steps exactly. Do not deviate, debug, or retry. Run each command once.

Step 1: Install the SDK (must be v0.1.1+ for signature fix)
```bash
pip install --no-cache-dir 'oacp-sdk>=0.1.1'
```

Step 2: Write /tmp/oacp_agent.py with EXACTLY this content (do not modify):
```python
import json
from oacp import OACPClient

client = OACPClient(
    name="cloud-managed-agent",
    capabilities=["cloud-compute", "autonomous-tasks"],
    owner_handle="matt",
    description="Anthropic Managed Agent running in the cloud via Managed Agents API",
)
client.register()
print(f"Registered as {client.agent_id}")

# Discover research agents
result = client.discover(capability="research-summarization", status="online")
print(f"Found {result.total} research agents")

for agent in result.agents:
    print(f"  - {agent.name} (ID: {agent.agent_id[:12]}...)")

# Send a task to the first research agent found
if result.agents:
    target = result.agents[0]
    print(f"\\nSending research task to {target.name}...")
    task_result = client.send_task(
        target.agent_id,
        action="summarize-text",
        payload={
            "task": "Explain how autonomous cloud agents can collaborate with local agents through open protocols like OACP",
            "max_words": 150,
        },
        timeout=60.0,
    )
    print(f"\\nTask result:\\n{json.dumps(task_result, indent=2)}")
else:
    print("No research agents found online.")

client.close()
print("\\nDone!")
```

Step 3: Run the script
```bash
python /tmp/oacp_agent.py
```

That's it. Write the file and run it. Do not modify the code.
"""

# --- Step 1: Create the agent ---
print("Creating Managed Agent...")
agent = client.beta.agents.create(
    name="OACP Cloud Agent",
    model="claude-haiku-4-5-20251001",
    system=OACP_SYSTEM_PROMPT,
    tools=[{"type": "agent_toolset_20260401"}],
)
print(f"Agent ID: {agent.id} (version {agent.version})")

# --- Step 2: Create environment with network access ---
print("Creating cloud environment...")
environment = client.beta.environments.create(
    name="oacp-env",
    config={
        "type": "cloud",
        "networking": {"type": "unrestricted"},
    },
)
print(f"Environment ID: {environment.id}")

# --- Step 3: Start session ---
print("Starting session...")
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    title="OACP Network Integration",
)
print(f"Session ID: {session.id}")

# --- Step 4: Send message and stream response ---
print("\n" + "=" * 60)
print("MANAGED AGENT OUTPUT")
print("=" * 60 + "\n")

with client.beta.sessions.events.stream(session.id) as stream:
    client.beta.sessions.events.send(
        session.id,
        events=[
            {
                "type": "user.message",
                "content": [
                    {
                        "type": "text",
                        "text": "Connect to the OACP network, discover available agents, and if you find a research agent, ask it to summarize how cloud agents can collaborate with local agents through open protocols.",
                    },
                ],
            },
        ],
    )

    for event in stream:
        if event.type == "agent.message":
            for block in event.content:
                if hasattr(block, "text"):
                    print(block.text, end="", flush=True)
        elif event.type == "agent.tool_use":
            print(f"\n[Tool: {event.name}]", flush=True)
        elif event.type == "agent.tool_result":
            # Show truncated tool output for visibility
            if hasattr(event, "content"):
                for block in event.content:
                    if hasattr(block, "text") and block.text:
                        text = block.text[:500]
                        print(f"  > {text}", flush=True)
        elif event.type == "session.status_idle":
            print("\n\nAgent finished.")
            break

print("\n" + "=" * 60)
print("Done!")
