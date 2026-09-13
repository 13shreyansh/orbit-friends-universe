from __future__ import annotations

import asyncio
import re

from app.ports.conversation_agent import (
    AgentConversationAnswer,
    AgentConversationContext,
)


def _tokens(value: str) -> set[str]:
    normalized = value.casefold()
    words = set(re.findall(r"[a-z0-9]{2,}", normalized))
    chinese = re.findall(r"[\u3400-\u9fff]+", normalized)
    for sequence in chinese:
        if len(sequence) == 1:
            words.add(sequence)
        words.update(sequence[index:index + 2] for index in range(len(sequence) - 1))
    return words


class LocalConversationAgent:
    """Deterministic local fallback with citations to confirmed SQL facts."""

    provider_name = "local-conversation"

    async def respond(
        self,
        prompt: str,
        context: AgentConversationContext,
    ) -> AgentConversationAnswer:
        prompt_tokens = _tokens(prompt)
        ranked = sorted(
            context.confirmed_memories,
            key=lambda memory: (
                len(prompt_tokens & _tokens(" ".join([
                    memory.summary,
                    memory.location,
                    " ".join(memory.facts),
                    " ".join(person.name for person in memory.people),
                ]))),
                memory.event_time,
            ),
            reverse=True,
        )
        matched = [
            memory for memory in ranked
            if not prompt_tokens or prompt_tokens & _tokens(
                f"{memory.summary} {' '.join(memory.facts)} {' '.join(person.name for person in memory.people)}"
            )
        ][:3]
        if not matched:
            matched = ranked[:3]
        if matched:
            facts = "；".join(
                f"{memory.event_time.isoformat()}：{memory.summary}" for memory in matched
            )
            content = f"These confirmed memories are connected to your question: {facts}."
        elif context.agent_memory_recalls:
            content = "There is related context, but no confirmed memory to cite. You can review or add a memory first."
        else:
            content = "There are no confirmed memories to cite yet. Add a memory to begin."
        lower = prompt.casefold()
        propose = any(marker in lower for marker in ("记住", "记录下来", "加入记忆", "remember this"))
        return AgentConversationAnswer(
            content=content,
            cited_memory_ids=[memory.id for memory in matched],
            propose_memory=propose,
        )


class E2EConversationAgent(LocalConversationAgent):
    """Explicit test provider for deterministic browser failure and reconnect paths."""

    provider_name = "e2e-conversation"

    async def respond(
        self,
        prompt: str,
        context: AgentConversationContext,
    ) -> AgentConversationAnswer:
        if "[[e2e-delay]]" in prompt:
            await asyncio.sleep(20)
        if "[[e2e-fail]]" in prompt:
            raise TimeoutError("Synthetic E2E provider failure.")
        return await super().respond(prompt, context)
