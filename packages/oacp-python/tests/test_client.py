"""Tests for the OACP Python client."""

import json
from unittest.mock import MagicMock, patch

import pytest

from oacp.client import OACPClient, _canonicalize
from oacp.types import AgentCard, Message, DiscoverResult


# ── Canonicalization ──

def test_canonicalize_sorts_keys():
    obj = {"z": 1, "a": 2, "m": 3}
    result = _canonicalize(obj)
    assert result == '{"a":2,"m":3,"z":1}'


def test_canonicalize_no_whitespace():
    obj = {"key": "value", "nested": {"a": 1}}
    result = _canonicalize(obj)
    assert " " not in result
    assert "\n" not in result


def test_canonicalize_nested_sorting():
    obj = {"b": {"z": 1, "a": 2}, "a": 1}
    result = _canonicalize(obj)
    parsed = json.loads(result)
    assert list(parsed.keys()) == ["a", "b"]


# ── Types ──

def test_agent_card_from_dict():
    data = {
        "agent_id": "abc-123",
        "name": "test-agent",
        "capabilities": ["research"],
        "status": "online",
        "public_key": "deadbeef",
        "owner_handle": "matt",
        "metadata": {
            "action_specs": [{"name": "summarize", "price": 10}]
        },
    }
    card = AgentCard.from_dict(data)
    assert card.agent_id == "abc-123"
    assert card.name == "test-agent"
    assert card.capabilities == ["research"]
    assert card.status == "online"
    assert card.owner_handle == "matt"
    assert len(card.action_specs) == 1
    assert card.action_specs[0]["name"] == "summarize"


def test_agent_card_from_dict_minimal():
    data = {"agent_id": "x", "name": "y", "capabilities": [], "status": "offline", "public_key": ""}
    card = AgentCard.from_dict(data)
    assert card.agent_id == "x"
    assert card.action_specs == []
    assert card.owner_handle is None


def test_message_from_dict():
    data = {
        "message_id": "msg-1",
        "sender_agent_id": "a",
        "recipient_agent_id": "b",
        "message_type": "task_request",
        "payload": {"action": "test"},
        "correlation_id": "corr-1",
    }
    msg = Message.from_dict(data)
    assert msg.message_id == "msg-1"
    assert msg.message_type == "task_request"
    assert msg.payload["action"] == "test"
    assert msg.correlation_id == "corr-1"


def test_discover_result_from_dict():
    data = {
        "agents": [
            {"agent_id": "a1", "name": "agent-1", "capabilities": ["x"], "status": "online", "public_key": "pk"},
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }
    result = DiscoverResult.from_dict(data)
    assert result.total == 1
    assert len(result.agents) == 1
    assert result.agents[0].name == "agent-1"


def test_discover_result_empty():
    data = {"agents": [], "total": 0, "page": 1, "page_size": 20}
    result = DiscoverResult.from_dict(data)
    assert result.total == 0
    assert result.agents == []


# ── Client initialization ──

def test_client_generates_keypair():
    client = OACPClient(name="test", capabilities=["testing"])
    assert client.public_key is not None
    assert len(client.public_key) == 64  # 32 bytes hex-encoded
    client.close()


def test_client_default_registry():
    client = OACPClient(name="test", capabilities=["testing"])
    assert "supabase.co" in client._registry_url
    client.close()


def test_client_custom_registry():
    client = OACPClient(
        name="test",
        capabilities=["testing"],
        registry_url="https://custom.example.com",
        registry_key="custom-key",
    )
    assert client._registry_url == "https://custom.example.com"
    assert client._registry_key == "custom-key"
    client.close()


def test_client_not_registered_raises():
    client = OACPClient(name="test", capabilities=["testing"])
    with pytest.raises(RuntimeError, match="not registered"):
        client._auth_headers()
    client.close()


def test_client_signs_messages():
    client = OACPClient(name="test", capabilities=["testing"])
    sig = client._sign("hello world")
    assert isinstance(sig, str)
    assert len(sig) == 128  # 64 bytes hex-encoded
    client.close()


def test_client_different_keys_each_instance():
    c1 = OACPClient(name="a", capabilities=["x"])
    c2 = OACPClient(name="b", capabilities=["y"])
    assert c1.public_key != c2.public_key
    c1.close()
    c2.close()


# ── Registration (mocked HTTP) ──

@patch("oacp.client.httpx.Client")
def test_register_sets_agent_id(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"agent_id": "uuid-123", "registry_token": "tok-456"}
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.post.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["research"], owner_handle="matt")
    agent_id = client.register()

    assert agent_id == "uuid-123"
    assert client.agent_id == "uuid-123"
    assert client._registry_token == "tok-456"

    # Verify the POST was called with correct body
    call_args = mock_http.post.call_args
    body = call_args[1]["json"]
    assert body["name"] == "test"
    assert body["capabilities"] == ["research"]
    assert body["owner_handle"] == "matt"
    assert "public_key" in body


# ── Discovery (mocked HTTP) ──

@patch("oacp.client.httpx.Client")
def test_discover_returns_agents(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "agents": [
            {"agent_id": "a1", "name": "agent-1", "capabilities": ["sentiment"], "status": "online", "public_key": "pk1"},
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.get.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["x"])
    result = client.discover(capability="sentiment")

    assert result.total == 1
    assert result.agents[0].name == "agent-1"


# ── Message lifetimes (RFC 001 §5) ──

@patch("oacp.client.httpx.Client")
def test_send_lifetime_fields_ride_outside_signature(mock_client_cls):
    from nacl.signing import VerifyKey

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "message_id": "m1",
        "visibility": "private",
        "expires_at": "2026-07-29T00:00:00Z",
        "burn_after_read": True,
    }
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.post.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["x"])
    client.agent_id = "sender-1"
    client._registry_token = "tok"

    client.send("recipient-1", "chat", {"text": "secret"}, ttl_seconds=300, burn_after_read=True)

    body = mock_http.post.call_args[1]["json"]
    assert body["ttl_seconds"] == 300
    assert body["burn_after_read"] is True

    # The signature must cover the canonical WITHOUT the lifetime fields —
    # they are routing metadata like visibility, added after signing.
    canonical = _canonicalize({
        k: v for k, v in body.items()
        if k not in ("signature", "ttl_seconds", "burn_after_read")
    })
    VerifyKey(bytes.fromhex(client.public_key)).verify(
        canonical.encode(), bytes.fromhex(body["signature"])
    )
    client.close()


@patch("oacp.client.httpx.Client")
def test_receipt_echoes_lifetime(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "message_id": "m2",
        "visibility": "private",
        "expires_at": "2026-07-29T00:00:00Z",
        "burn_after_read": True,
    }
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.post.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["x"])
    client.agent_id = "sender-1"
    client._registry_token = "tok"

    receipt = client.send_checked(
        "recipient-1", "chat", {"text": "s"}, ttl_seconds=300, burn_after_read=True
    )
    assert receipt["expires_at"] == "2026-07-29T00:00:00Z"
    assert receipt["burn_after_read"] is True
    client.close()


@patch("oacp.client.httpx.Client")
def test_receipt_omits_lifetime_when_registry_silent(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"message_id": "m3", "visibility": "open"}
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.post.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["x"])
    client.agent_id = "sender-1"
    client._registry_token = "tok"

    receipt = client.send_checked("recipient-1", "task_request", {"action": "x"})
    assert "expires_at" not in receipt
    assert "burn_after_read" not in receipt
    client.close()


def test_message_from_dict_lifetime_fields():
    m = Message.from_dict({
        "message_id": "m4",
        "sender_agent_id": "a",
        "recipient_agent_id": "b",
        "message_type": "chat",
        "payload": {},
        "expires_at": "2026-07-29T00:00:00Z",
        "burn_after_read": True,
    })
    assert m.expires_at == "2026-07-29T00:00:00Z"
    assert m.burn_after_read is True


# ── Context manager ──

def test_context_manager():
    with OACPClient(name="test", capabilities=["x"]) as client:
        assert client.public_key is not None
    # Should not raise after exit
