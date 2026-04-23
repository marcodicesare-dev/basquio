import Anthropic from "@anthropic-ai/sdk";

const PAUSE_TURN_CONTINUATION_TEXT =
  "Continue from exactly where you paused. Resume the same task, do not restart from the beginning, preserve the existing container state, and continue producing the required deliverable files.";
const INTERRUPTED_TOOL_EXECUTION_TEXT =
  "[Basquio note: tool execution was interrupted before tool results were returned. Resume from the current container state.]";

export function appendAssistantTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  message: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaMessageParam[] {
  // Strip orphaned tool_use blocks that lack a matching tool_result in the same message.
  // This happens when code execution is interrupted during a pause_turn — the assistant
  // message contains the tool_use but the API never appended the tool_result.
  const content = message.content as Anthropic.Beta.BetaContentBlockParam[];
  const resultToolIds = new Set<string>();
  for (const block of content) {
    const b = block as unknown as Record<string, unknown>;
    if (
      typeof b.type === "string" &&
      b.type.endsWith("_tool_result") &&
      typeof b.tool_use_id === "string"
    ) {
      resultToolIds.add(b.tool_use_id);
    }
  }
  const safeContent = content.filter((block) => {
    const b = block as unknown as Record<string, unknown>;
    if (
      typeof b.type === "string" &&
      b.type.endsWith("_tool_use") &&
      typeof b.id === "string" &&
      !resultToolIds.has(b.id)
    ) {
      return false;
    }
    return true;
  });

  return [
    ...messages,
    {
      role: "assistant",
      content: safeContent.length > 0
        ? safeContent
        : [{ type: "text", text: INTERRUPTED_TOOL_EXECUTION_TEXT }],
    },
  ];
}

export function appendPauseTurnContinuation(
  messages: Anthropic.Beta.BetaMessageParam[],
  message: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaMessageParam[] {
  return [
    ...appendAssistantTurn(messages, message),
    {
      role: "user",
      content: [{ type: "text", text: PAUSE_TURN_CONTINUATION_TEXT }],
    },
  ];
}

export function getPauseTurnContinuationText() {
  return PAUSE_TURN_CONTINUATION_TEXT;
}
