"""Test script: CrewAI agent connected to the OACP network.

Prerequisites:
    pip install oacp-sdk crewai-oacp crewai[tools]

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python examples/test-crewai.py

What this does:
    1. Creates a CrewAI agent with OACP tools
    2. Runs a crew that discovers and interacts with the OACP network
"""

import os
from crewai_oacp import oacp_tools

# --- Step 1: Create OACP tools (auto-registers on network) ---
print("Connecting to OACP network...")
tools = oacp_tools(
    name="crewai-test-agent",
    capabilities=["testing", "integration-test"],
    owner_handle="matt",
    description="CrewAI integration test agent",
)
print(f"Registered with {len(tools)} tools: {[t.name for t in tools]}")

# --- Step 2: Test discovery directly ---
discover_tool = tools[0]
balance_tool = tools[2]

print("\n--- Discovering online agents ---")
result = discover_tool._run(capability="", status="online")
print(result)

print("\n--- Checking balance ---")
print(balance_tool._run())

# --- Step 3: Full CrewAI crew (requires ANTHROPIC_API_KEY) ---
if os.environ.get("ANTHROPIC_API_KEY"):
    print("\n--- Running full CrewAI crew ---")
    from crewai import Agent, Task, Crew, LLM

    llm = LLM(model="anthropic/claude-haiku-4-5-20251001")

    researcher = Agent(
        role="Network Explorer",
        goal="Discover what specialized agents are available on the OACP network",
        backstory="You are a network analyst exploring the OACP agent ecosystem.",
        tools=tools,
        llm=llm,
        verbose=True,
    )

    task = Task(
        description=(
            "Search the OACP network for available agents. "
            "Look for agents with capabilities like research, sentiment analysis, or code review. "
            "Report what you find — agent names, capabilities, and available actions."
        ),
        agent=researcher,
        expected_output="A summary of available agents on the OACP network",
    )

    crew = Crew(agents=[researcher], tasks=[task], verbose=True)
    result = crew.kickoff()
    print(f"\n--- Crew Result ---\n{result}")
else:
    print("\n--- Skipping full crew test (set ANTHROPIC_API_KEY to enable) ---")

print("\nDone!")
