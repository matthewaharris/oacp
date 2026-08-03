"""Tests for LangChain OACP tools."""

import json
from unittest.mock import MagicMock

import pytest

from oacp.types import AgentCard, DiscoverResult

# These tests validate tool behavior without requiring langchain-core installed.
# When langchain-core is available, they test the full integration.

try:
    from langchain_oacp.tools import OACPDiscoverTool, OACPSendTaskTool, OACPCheckBalanceTool
    HAS_LANGCHAIN = True
except ImportError:
    HAS_LANGCHAIN = False

pytestmark = pytest.mark.skipif(not HAS_LANGCHAIN, reason="langchain-core not installed")


def _mock_client():
    client = MagicMock()
    client.agent_id = "test-agent-id"
    return client


def test_discover_tool_returns_agents():
    client = _mock_client()
    client.discover.return_value = DiscoverResult(
        agents=[
            AgentCard(
                agent_id="a1",
                name="sentiment-bot",
                capabilities=["sentiment-analysis"],
                status="online",
                public_key="pk",
                metadata={"action_specs": [{"name": "analyze-sentiment", "description": "Analyze text sentiment", "price": 5}]},
            ),
        ],
        total=1,
        page=1,
        page_size=20,
    )

    tool = OACPDiscoverTool(oacp_client=client)
    result = tool._run(capability="sentiment-analysis")
    parsed = json.loads(result)

    assert parsed["found"] == 1
    assert parsed["agents"][0]["name"] == "sentiment-bot"
    assert parsed["agents"][0]["actions"][0]["name"] == "analyze-sentiment"


def test_discover_tool_no_results():
    client = _mock_client()
    client.discover.return_value = DiscoverResult(agents=[], total=0, page=1, page_size=20)

    tool = OACPDiscoverTool(oacp_client=client)
    result = tool._run(capability="nonexistent")

    assert "No agents found" in result


def test_send_task_tool_returns_result():
    client = _mock_client()
    client.send_task.return_value = {"sentiment": "positive", "confidence": 0.95}

    tool = OACPSendTaskTool(oacp_client=client)
    result = tool._run(
        agent_id="a1",
        action="analyze-sentiment",
        payload='{"text": "hello world"}',
    )
    parsed = json.loads(result)

    assert parsed["sentiment"] == "positive"
    assert parsed["confidence"] == 0.95


def test_send_task_tool_invalid_json():
    client = _mock_client()
    tool = OACPSendTaskTool(oacp_client=client)
    result = tool._run(agent_id="a1", action="test", payload="not json")

    assert "Error: payload must be valid JSON" in result


def test_send_task_tool_timeout():
    client = _mock_client()
    client.send_task.side_effect = TimeoutError("No response within 30.0s for task msg-1")

    tool = OACPSendTaskTool(oacp_client=client)
    result = tool._run(agent_id="a1", action="test", payload='{"x": 1}')

    assert "did not respond" in result


def test_send_task_tool_task_error():
    client = _mock_client()
    client.send_task.side_effect = RuntimeError("Task failed: out of budget")

    tool = OACPSendTaskTool(oacp_client=client)
    result = tool._run(agent_id="a1", action="test", payload='{"x": 1}')

    assert "Task failed" in result


def test_check_balance_tool():
    client = _mock_client()
    client.get_balance.return_value = 4200

    tool = OACPCheckBalanceTool(oacp_client=client)
    result = tool._run()
    parsed = json.loads(result)

    assert parsed["balance"] == 4200
    assert parsed["unit"] == "OACP tokens"
