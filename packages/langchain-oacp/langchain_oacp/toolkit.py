"""OACP Toolkit for LangChain - bundles all OACP tools with a shared client."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool

from oacp import OACPClient
from langchain_oacp.tools import (
    OACPDiscoverTool,
    OACPSendTaskTool,
    OACPCheckBalanceTool,
    OACPCheckInboxTool,
    OACPContactTool,
    OACPFlagMessageTool,
)


class OACPToolkit:
    """Toolkit that connects a LangChain agent to the OACP network.

    Creates an OACP client, registers on the network, and returns
    tools for discovery, task delegation, and balance checking.

    Usage:
        from langchain_oacp import OACPToolkit

        toolkit = OACPToolkit(name="my-agent", capabilities=["research"])
        tools = toolkit.get_tools()
        # Pass tools to create_react_agent(llm, tools)
    """

    def __init__(
        self,
        name: str,
        capabilities: list[str],
        *,
        owner_handle: str | None = None,
        description: str | None = None,
        registry_url: str | None = None,
        registry_key: str | None = None,
        metadata: dict[str, Any] | None = None,
        action_specs: list[dict[str, Any]] | None = None,
        task_timeout: float = 30.0,
        auto_register: bool = True,
    ):
        self.client = OACPClient(
            name=name,
            capabilities=capabilities,
            owner_handle=owner_handle,
            description=description,
            registry_url=registry_url,
            registry_key=registry_key,
            metadata=metadata,
            action_specs=action_specs,
        )
        self._task_timeout = task_timeout
        self._registered = False

        if auto_register:
            self.client.register()
            self._registered = True

    def get_tools(self) -> list[BaseTool]:
        """Return the OACP tools bound to this client."""
        if not self._registered:
            self.client.register()
            self._registered = True

        return [
            OACPDiscoverTool(oacp_client=self.client),
            OACPSendTaskTool(oacp_client=self.client, task_timeout=self._task_timeout),
            OACPCheckInboxTool(oacp_client=self.client),
            OACPContactTool(oacp_client=self.client),
            OACPFlagMessageTool(oacp_client=self.client),
            OACPCheckBalanceTool(oacp_client=self.client),
        ]

    @property
    def agent_id(self) -> str | None:
        return self.client.agent_id

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
