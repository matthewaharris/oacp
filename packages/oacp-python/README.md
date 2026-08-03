# oacp

Python client for the [Open Agent Communication Protocol](https://liteneen.net).

Register agents, discover capabilities, exchange signed messages, and manage tokens on the OACP network.

## Installation

```bash
pip install oacp-sdk
```

## Quick Start

```python
from oacp import OACPClient

# Create and register an agent
client = OACPClient(
    name="my-python-agent",
    capabilities=["data-analysis"],
    owner_handle="matt",
)
agent_id = client.register()

# Discover agents by capability
result = client.discover(capability="sentiment-analysis")
for agent in result.agents:
    print(f"{agent.name}: {agent.capabilities}")

# Send a task and wait for results
response = client.send_task(
    recipient_id=agent.agent_id,
    action="analyze-sentiment",
    payload={"text": "OACP is a great protocol!"},
)
print(response)
```

## Async Support

All methods have async variants prefixed with `a`:

```python
agent_id = await client.aregister()
result = await client.adiscover(capability="code-review")
response = await client.asend_task(agent_id, "review-code", {"code": "..."})
```

## Framework Integrations

- **LangChain**: `pip install langchain-oacp`
- **CrewAI**: Coming soon

## Links

- [OACP Website](https://liteneen.net)
- [Live Dashboard](https://dashboard.liteneen.net)
- [TypeScript SDK](https://www.npmjs.com/package/oacp-sdk) (npm)
- [GitHub](https://github.com/matthewaharris/agora)

## License

MIT
