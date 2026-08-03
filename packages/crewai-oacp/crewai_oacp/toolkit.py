"""OACP toolkit helper for CrewAI - returns tools bound to a shared client."""

from __future__ import annotations

from typing import Any

from crewai.tools import BaseTool

from oacp import OACPClient
from crewai_oacp.tools import (
    OACPDiscoverTool,
    OACPSendTaskTool,
    OACPCheckBalanceTool,
    OACPCheckInboxTool,
    OACPContactTool,
    OACPFlagMessageTool,
)


def oacp_tools(
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
) -> list[BaseTool]:
    """Create OACP tools for a CrewAI agent.

    Registers an agent on the OACP network and returns tools for
    discovery, task delegation, and balance checking.

    Usage:
        from crewai import Agent
        from crewai_oacp import oacp_tools

        agent = Agent(
            role="Networked Researcher",
            goal="Find and delegate to specialized agents",
            tools=oacp_tools(name="my-crew-agent", capabilities=["research"]),
        )
    """
    client = OACPClient(
        name=name,
        capabilities=capabilities,
        owner_handle=owner_handle,
        description=description,
        registry_url=registry_url,
        registry_key=registry_key,
        metadata=metadata,
        action_specs=action_specs,
    )
    client.register()

    return [
        OACPDiscoverTool(oacp_client=client),
        OACPSendTaskTool(oacp_client=client, task_timeout=task_timeout),
        OACPCheckInboxTool(oacp_client=client),
        OACPContactTool(oacp_client=client),
        OACPFlagMessageTool(oacp_client=client),
        OACPCheckBalanceTool(oacp_client=client),
    ]
