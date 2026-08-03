"""Type definitions for OACP protocol objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentCard:
    """An agent registered on the OACP network."""

    agent_id: str
    name: str
    capabilities: list[str]
    status: str
    public_key: str
    owner_handle: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    last_seen_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentCard:
        return cls(
            agent_id=data["agent_id"],
            name=data["name"],
            capabilities=data.get("capabilities", []),
            status=data.get("status", "unknown"),
            public_key=data.get("public_key", ""),
            owner_handle=data.get("owner_handle"),
            description=data.get("description"),
            metadata=data.get("metadata", {}),
            last_seen_at=data.get("last_seen_at"),
        )

    @property
    def action_specs(self) -> list[dict[str, Any]]:
        return self.metadata.get("action_specs", [])


@dataclass
class Message:
    """A message exchanged between OACP agents."""

    message_id: str
    sender_agent_id: str
    recipient_agent_id: str
    message_type: str
    payload: dict[str, Any]
    signature: str | None = None
    correlation_id: str | None = None
    timestamp: str | None = None
    #: RFC 005 — "quarantined" means first contact from an unknown sender and
    #: the registry withheld the payload until this agent accepts them.
    delivery_status: str | None = None
    #: RFC 001 §5 — when this payload will be destroyed, if the sender set a TTL.
    expires_at: str | None = None
    #: RFC 001 §5 — payload is destroyed after this recipient's first fetch;
    #: save what you need now, a re-read will find it redacted.
    burn_after_read: bool = False
    #: RFC 005 — registry-attested provenance of the other party. Trust this,
    #: never identity claims made inside the payload.
    sender_info: CounterpartInfo | None = None
    recipient_info: CounterpartInfo | None = None

    @property
    def is_quarantined(self) -> bool:
        """True when the payload is withheld pending a human decision."""
        return self.delivery_status == "quarantined"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Message:
        return cls(
            message_id=data["message_id"],
            sender_agent_id=data["sender_agent_id"],
            recipient_agent_id=data["recipient_agent_id"],
            message_type=data["message_type"],
            payload=data.get("payload", {}),
            signature=data.get("signature"),
            correlation_id=data.get("correlation_id"),
            timestamp=data.get("timestamp"),
            delivery_status=data.get("delivery_status"),
            expires_at=data.get("expires_at"),
            burn_after_read=data.get("burn_after_read", False),
            sender_info=CounterpartInfo.from_dict(data.get("sender_info")),
            recipient_info=CounterpartInfo.from_dict(data.get("recipient_info")),
        )


@dataclass
class CounterpartInfo:
    """
    RFC 005 — who is on the other end, as attested by the registry.

    Use this to decide how much to trust a message; anything the payload
    says about its own identity or authority is unverified.
    """

    agent_id: str
    name: str | None = None
    handle: str | None = None
    owner_handle: str | None = None
    #: Owner handle proved by a DNS TXT record (RFC 002 §4).
    domain_verified: bool = False
    #: friend | accepted_contact | stranger | blocked
    relationship: str = "stranger"

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> CounterpartInfo | None:
        if not data:
            return None
        return cls(
            agent_id=data.get("agent_id", ""),
            name=data.get("name"),
            handle=data.get("handle"),
            owner_handle=data.get("owner_handle"),
            domain_verified=bool(data.get("domain_verified")),
            relationship=data.get("relationship", "stranger"),
        )


@dataclass
class DiscoverResult:
    """Result of an agent discovery query."""

    agents: list[AgentCard]
    total: int
    page: int
    page_size: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DiscoverResult:
        return cls(
            agents=[AgentCard.from_dict(a) for a in data.get("agents", [])],
            total=data.get("total", 0),
            page=data.get("page", 1),
            page_size=data.get("page_size", 20),
        )
