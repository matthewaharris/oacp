"""OACP Python client - talks directly to the OACP REST API."""

from __future__ import annotations

import json
import time
from typing import Any

import warnings

import httpx
from nacl.signing import SigningKey, VerifyKey
from nacl.encoding import HexEncoder

from oacp.types import AgentCard, DiscoverResult, Message

OACP_PUBLIC_REGISTRY_URL = "https://zhenbunwugeskqtghjyt.supabase.co"
OACP_PUBLIC_REGISTRY_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW5idW53dWdlc2txdGdoanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTM3NDYsImV4cCI6MjA5MDU2OTc0Nn0."
    "hU5C6yESrm0B8-hsXTY-XEYkgLegx-2SdpH8E3RMSGU"
)
API_PATH = "/functions/v1/oacp"


def _canonicalize(obj: dict[str, Any]) -> str:
    """Canonical JSON matching the Node SDK's canonicalizeMessage.

    Top-level keys are sorted alphabetically. Nested objects (like payload)
    preserve their original key order — this matches JSON.stringify behavior
    in JavaScript which the server uses for signature verification.
    """
    canonical: dict[str, Any] = {}
    for key in sorted(obj.keys()):
        canonical[key] = obj[key]
    return json.dumps(canonical, separators=(",", ":"))


class OACPClient:
    """Lightweight Python client for the OACP registry API.

    Handles registration, discovery, messaging, and Ed25519 signing.
    """

    def __init__(
        self,
        name: str,
        capabilities: list[str],
        *,
        registry_url: str | None = None,
        registry_key: str | None = None,
        owner_handle: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        action_specs: list[dict[str, Any]] | None = None,
    ):
        self.name = name
        self.capabilities = capabilities
        self.owner_handle = owner_handle
        self.description = description
        self.metadata = metadata or {}
        # RFC 005: declaring actions with an input_schema is what lets the
        # registry reject malformed or unknown stranger task_requests before
        # they ever reach this agent. Without it, strangers still quarantine
        # but nothing validates their payload shape.
        self.action_specs = action_specs or []

        self._registry_url = registry_url or OACP_PUBLIC_REGISTRY_URL
        self._registry_key = registry_key or OACP_PUBLIC_REGISTRY_KEY
        self._base_url = f"{self._registry_url}{API_PATH}"

        # Generate Ed25519 keypair
        self._signing_key = SigningKey.generate()
        self._verify_key = self._signing_key.verify_key
        self.public_key = self._verify_key.encode(encoder=HexEncoder).decode()

        # Set after registration
        self.agent_id: str | None = None
        #: Wire state of the most recent send (see send_checked)
        self.last_receipt: dict[str, Any] | None = None
        self._registry_token: str | None = None

        self._http = httpx.Client(
            headers={
                "Content-Type": "application/json",
                "apikey": self._registry_key,
            },
            timeout=30.0,
        )
        self._async_http = httpx.AsyncClient(
            headers={
                "Content-Type": "application/json",
                "apikey": self._registry_key,
            },
            timeout=30.0,
        )

    def _auth_headers(self) -> dict[str, str]:
        if not self._registry_token:
            raise RuntimeError("Agent not registered. Call register() first.")
        return {"Authorization": f"Bearer {self._registry_token}"}

    def _sign(self, message: str) -> str:
        signed = self._signing_key.sign(message.encode(), encoder=HexEncoder)
        return signed.signature.decode()

    # ── Registration ──

    def register(self) -> str:
        """Register this agent on the OACP network. Returns agent_id."""
        body: dict[str, Any] = {
            "name": self.name,
            "capabilities": self.capabilities,
            "public_key": self.public_key,
        }
        if self.owner_handle:
            body["owner_handle"] = self.owner_handle
        if self.description:
            body["description"] = self.description
        metadata = dict(self.metadata)
        if self.action_specs:
            metadata["action_specs"] = [
                {
                    "name": s["name"],
                    "description": s.get("description", ""),
                    "price": s.get("price", 0),
                    **({"input_schema": s["input_schema"]} if s.get("input_schema") else {}),
                }
                for s in self.action_specs
            ]
        if metadata:
            body["metadata"] = metadata

        resp = self._http.post(f"{self._base_url}/register", json=body)
        resp.raise_for_status()
        data = resp.json()

        self.agent_id = data["agent_id"]
        self._registry_token = data.get("registry_token")
        return self.agent_id

    async def aregister(self) -> str:
        """Async version of register()."""
        body: dict[str, Any] = {
            "name": self.name,
            "capabilities": self.capabilities,
            "public_key": self.public_key,
        }
        if self.owner_handle:
            body["owner_handle"] = self.owner_handle
        if self.description:
            body["description"] = self.description
        metadata = dict(self.metadata)
        if self.action_specs:
            metadata["action_specs"] = [
                {
                    "name": s["name"],
                    "description": s.get("description", ""),
                    "price": s.get("price", 0),
                    **({"input_schema": s["input_schema"]} if s.get("input_schema") else {}),
                }
                for s in self.action_specs
            ]
        if metadata:
            body["metadata"] = metadata

        resp = await self._async_http.post(f"{self._base_url}/register", json=body)
        resp.raise_for_status()
        data = resp.json()

        self.agent_id = data["agent_id"]
        self._registry_token = data.get("registry_token")
        return self.agent_id

    # ── Heartbeat ──

    def heartbeat(self) -> dict[str, Any]:
        """Send a heartbeat to stay online."""
        resp = self._http.post(
            f"{self._base_url}/heartbeat",
            json={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    async def aheartbeat(self) -> dict[str, Any]:
        resp = await self._async_http.post(
            f"{self._base_url}/heartbeat",
            json={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    # ── Discovery ──

    def discover(
        self,
        *,
        capability: str | None = None,
        status: str | None = None,
        owner_handle: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> DiscoverResult:
        """Discover agents on the network by capability, status, or owner."""
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if capability:
            params["capability"] = capability
        if status:
            params["status"] = status
        if owner_handle:
            params["owner_handle"] = owner_handle

        resp = self._http.get(f"{self._base_url}/discover", params=params)
        resp.raise_for_status()
        return DiscoverResult.from_dict(resp.json())

    async def adiscover(
        self,
        *,
        capability: str | None = None,
        status: str | None = None,
        owner_handle: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> DiscoverResult:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if capability:
            params["capability"] = capability
        if status:
            params["status"] = status
        if owner_handle:
            params["owner_handle"] = owner_handle

        resp = await self._async_http.get(f"{self._base_url}/discover", params=params)
        resp.raise_for_status()
        return DiscoverResult.from_dict(resp.json())

    # ── Messaging ──

    def send(
        self,
        recipient_id: str,
        message_type: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
        ttl_seconds: int | None = None,
        burn_after_read: bool = False,
    ) -> str:
        """
        Send a signed message. Returns message_id.

        RFC 001 §5 lifetimes: ttl_seconds (60 … 31536000 = 1 year) asks the
        registry to destroy the payload after that long; burn_after_read
        destroys it once the recipient has fetched it. Sealing decides who can
        read a payload; these decide how long it exists to be attacked later.
        Check last_receipt["expires_at"] to verify the lifetime took effect.
        """
        msg_body: dict[str, Any] = {
            "sender_agent_id": self.agent_id,
            "recipient_agent_id": recipient_id,
            "message_type": message_type,
            "payload": payload,
        }
        if correlation_id:
            msg_body["correlation_id"] = correlation_id

        # Sign canonical message
        canonical = _canonicalize(msg_body)
        msg_body["signature"] = self._sign(canonical)

        # Lifetime fields ride outside the signed canonical, like visibility.
        if ttl_seconds is not None:
            msg_body["ttl_seconds"] = ttl_seconds
        if burn_after_read:
            msg_body["burn_after_read"] = True

        resp = self._http.post(
            f"{self._base_url}/messages/send",
            json=msg_body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        self.last_receipt = self._receipt(data, sealed=False)
        self._warn_if_public(self.last_receipt, message_type)
        return data["message_id"]

    def _receipt(self, data: dict[str, Any], *, sealed: bool) -> dict[str, Any]:
        """What the registry actually did — not what the caller believed."""
        visibility = data.get("visibility", "open")
        receipt = {
            "message_id": data["message_id"],
            "sealed": sealed,
            "visibility": visibility,
            "delivery_status": data.get("delivery_status", "delivered"),
            "observer_readable": (not sealed) and visibility in ("open", "summarized"),
        }
        # RFC 001 §5 — echoed only when the registry actually set a lifetime.
        if data.get("expires_at"):
            receipt["expires_at"] = data["expires_at"]
        if data.get("burn_after_read"):
            receipt["burn_after_read"] = True
        return receipt

    @staticmethod
    def _warn_if_public(receipt: dict[str, Any], message_type: str) -> None:
        """
        Make a wrong wire state loud.

        An agent once published internal business detail onto open threads
        while sincerely reporting the channel was sealed. Defaults reduce how
        often that happens; this is what makes it visible when it still does.
        """
        if receipt["observer_readable"]:
            warnings.warn(
                f"OACP: this {message_type} went to the registry UNSEALED on a "
                f"'{receipt['visibility']}' thread — its contents are in the public read "
                f"model and readable by anyone. If you intended a private channel, seal it "
                f"and use visibility 'private'.",
                stacklevel=3,
            )
        if receipt["delivery_status"] == "quarantined":
            warnings.warn(
                "OACP: held as first contact — the recipient has not accepted this agent, "
                "so the payload is withheld until their human decides. It is not lost.",
                stacklevel=3,
            )

    def send_checked(
        self,
        recipient_id: str,
        message_type: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
        ttl_seconds: int | None = None,
        burn_after_read: bool = False,
    ) -> dict[str, Any]:
        """
        Send and return what the registry actually did, rather than just an id.

        Prefer this whenever content is sensitive: 'sealed' and
        'observer_readable' are the difference between believing a channel is
        private and knowing it. Likewise a requested lifetime is only real if
        'expires_at' / 'burn_after_read' come back on the receipt.
        """
        self.send(
            recipient_id,
            message_type,
            payload,
            correlation_id=correlation_id,
            ttl_seconds=ttl_seconds,
            burn_after_read=burn_after_read,
        )
        return self.last_receipt

    def current_thread_with(self, agent_id: str, *, max_age_hours: float = 24.0) -> str | None:
        """
        The correlation_id of the most recent active thread with an agent.

        Minting a fresh correlation_id mid-conversation fragments one workstream
        across threads, and drops replies onto threads that inherit different
        privacy defaults than the established channel.
        """
        import datetime as _dt

        try:
            msgs = self.get_messages(direction="inbox", limit=50) + self.get_messages(
                direction="outbox", limit=50
            )
        except Exception:
            return None
        candidates = [
            m for m in msgs
            if m.correlation_id
            and (m.sender_agent_id == agent_id or m.recipient_agent_id == agent_id)
            and not m.is_quarantined
            and m.timestamp
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda m: m.timestamp, reverse=True)
        newest = candidates[0]
        try:
            ts = _dt.datetime.fromisoformat(newest.timestamp.replace("Z", "+00:00"))
            age_h = (_dt.datetime.now(_dt.timezone.utc) - ts).total_seconds() / 3600
            if age_h > max_age_hours:
                return None
        except Exception:
            pass
        return newest.correlation_id

    async def asend(
        self,
        recipient_id: str,
        message_type: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
        ttl_seconds: int | None = None,
        burn_after_read: bool = False,
    ) -> str:
        msg_body: dict[str, Any] = {
            "sender_agent_id": self.agent_id,
            "recipient_agent_id": recipient_id,
            "message_type": message_type,
            "payload": payload,
        }
        if correlation_id:
            msg_body["correlation_id"] = correlation_id

        canonical = _canonicalize(msg_body)
        msg_body["signature"] = self._sign(canonical)

        if ttl_seconds is not None:
            msg_body["ttl_seconds"] = ttl_seconds
        if burn_after_read:
            msg_body["burn_after_read"] = True

        resp = await self._async_http.post(
            f"{self._base_url}/messages/send",
            json=msg_body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()["message_id"]

    # ── Message retrieval ──

    def get_messages(
        self,
        *,
        direction: str = "inbox",
        message_type: str | None = None,
        correlation_id: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> list[Message]:
        """Retrieve messages from inbox or outbox."""
        params: dict[str, Any] = {
            "agent_id": self.agent_id,
            "direction": direction,
            "limit": limit,
        }
        if message_type:
            params["message_type"] = message_type
        if correlation_id:
            params["correlation_id"] = correlation_id
        if since:
            params["since"] = since

        resp = self._http.get(
            f"{self._base_url}/messages",
            params=params,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return [Message.from_dict(m) for m in resp.json().get("messages", [])]

    async def aget_messages(
        self,
        *,
        direction: str = "inbox",
        message_type: str | None = None,
        correlation_id: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> list[Message]:
        params: dict[str, Any] = {
            "agent_id": self.agent_id,
            "direction": direction,
            "limit": limit,
        }
        if message_type:
            params["message_type"] = message_type
        if correlation_id:
            params["correlation_id"] = correlation_id
        if since:
            params["since"] = since

        resp = await self._async_http.get(
            f"{self._base_url}/messages",
            params=params,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return [Message.from_dict(m) for m in resp.json().get("messages", [])]

    # ── Task helpers ──

    def send_task(
        self,
        recipient_id: str,
        action: str,
        payload: dict[str, Any],
        *,
        timeout: float = 30.0,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Send a task_request and poll for the result. Returns the result payload."""
        task_payload = {"action": action, **payload}
        msg_id = self.send(recipient_id, "task_request", task_payload)

        deadline = time.time() + timeout
        while time.time() < deadline:
            # Try correlation_id match first
            messages = self.get_messages(
                message_type="task_result",
                correlation_id=msg_id,
            )
            if messages:
                return messages[0].payload

            # Some agents don't set correlation_id — fall back to checking
            # all task_results from the recipient
            all_results = self.get_messages(message_type="task_result")
            for m in all_results:
                if m.sender_agent_id == recipient_id:
                    return m.payload

            # Also check for errors
            errors = self.get_messages(
                message_type="task_error",
                correlation_id=msg_id,
            )
            if errors:
                error_payload = errors[0].payload
                raise RuntimeError(
                    f"Task failed: {error_payload.get('error', 'Unknown error')}"
                )

            time.sleep(poll_interval)

        raise TimeoutError(f"No response within {timeout}s for task {msg_id}")

    async def asend_task(
        self,
        recipient_id: str,
        action: str,
        payload: dict[str, Any],
        *,
        timeout: float = 30.0,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Async version of send_task()."""
        import asyncio

        task_payload = {"action": action, **payload}
        msg_id = await self.asend(recipient_id, "task_request", task_payload)

        deadline = time.time() + timeout
        while time.time() < deadline:
            messages = await self.aget_messages(
                message_type="task_result",
                correlation_id=msg_id,
            )
            if messages:
                return messages[0].payload

            errors = await self.aget_messages(
                message_type="task_error",
                correlation_id=msg_id,
            )
            if errors:
                error_payload = errors[0].payload
                raise RuntimeError(
                    f"Task failed: {error_payload.get('error', 'Unknown error')}"
                )

            await asyncio.sleep(poll_interval)

        raise TimeoutError(f"No response within {timeout}s for task {msg_id}")

    # ── Balance ──

    # ── RFC 005: inbound trust boundary ──

    def accept_sender(self, sender_agent_id: str) -> dict[str, Any]:
        """
        Accept a non-friend sender (RFC 005 §3).

        Releases every message the registry is holding from them and lets
        future messages deliver immediately. This is a human-consent decision:
        an unattended agent should not call it automatically.
        """
        resp = self._http.post(
            f"{self._base_url}/contacts/set",
            json={
                "agent_id": self.agent_id,
                "sender_agent_id": sender_agent_id,
                "status": "accepted",
            },
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def block_sender(self, sender_agent_id: str) -> dict[str, Any]:
        """Block a sender — their future messages bounce with sender_blocked."""
        resp = self._http.post(
            f"{self._base_url}/contacts/set",
            json={
                "agent_id": self.agent_id,
                "sender_agent_id": sender_agent_id,
                "status": "blocked",
            },
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def list_sender_decisions(self) -> list[dict[str, Any]]:
        """Standing accept/block decisions this agent has made."""
        resp = self._http.get(
            f"{self._base_url}/contacts",
            params={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json().get("contacts", [])

    def flag_message(
        self,
        message_id: str,
        reason: str = "prompt_injection",
        *,
        note: str | None = None,
        block: bool = False,
    ) -> dict[str, Any]:
        """
        Report a hostile inbound message (RFC 005 §4).

        reason: prompt_injection | spam | abuse | other. Flags from distinct
        recipients throttle (>=2 in 7 days) and then suspend (>=5) the
        sender's ability to message non-friends. Only the recipient of a
        message may flag it.
        """
        body: dict[str, Any] = {
            "agent_id": self.agent_id,
            "message_id": message_id,
            "reason": reason,
            "block": block,
        }
        if note:
            body["note"] = note
        resp = self._http.post(
            f"{self._base_url}/messages/flag",
            json=body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def pending_first_contacts(self) -> list[Message]:
        """
        Inbox messages held from unknown senders, awaiting a decision.

        Payloads are withheld by the registry, so these carry the sender's
        provenance and the requested action — not the content.
        """
        return [m for m in self.get_messages(direction="inbox", limit=100) if m.is_quarantined]

    def get_balance(self) -> int:
        """Get this agent's token balance."""
        resp = self._http.get(
            f"{self._base_url}/balance",
            params={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json().get("balance", 0)

    async def aget_balance(self) -> int:
        resp = await self._async_http.get(
            f"{self._base_url}/balance",
            params={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json().get("balance", 0)

    # ── Cleanup ──

    def close(self) -> None:
        """Close HTTP connections."""
        self._http.close()

    async def aclose(self) -> None:
        await self._async_http.aclose()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.aclose()
