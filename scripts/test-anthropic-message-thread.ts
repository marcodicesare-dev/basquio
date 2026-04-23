import assert from "node:assert/strict";

import type Anthropic from "@anthropic-ai/sdk";

import {
  appendAssistantTurn,
  appendPauseTurnContinuation,
  getPauseTurnContinuationText,
} from "../packages/workflows/src/anthropic-message-thread";

function main() {
  const baseMessages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: "Build the deck." }],
    },
  ];

  const pauseTurnMessage = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    stop_reason: "pause_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    content: [
      {
        type: "server_tool_use",
        id: "tool_1",
        name: "code_execution",
        input: { script: "print('hi')" },
      },
      {
        type: "text",
        text: "I paused while generating files.",
      },
    ],
  } as unknown as Anthropic.Beta.BetaMessage;

  const assistantOnly = appendAssistantTurn(baseMessages, pauseTurnMessage);
  assert.equal(assistantOnly.length, 2);
  assert.equal(assistantOnly[1]?.role, "assistant");
  assert.deepEqual(
    assistantOnly[1]?.content,
    [{ type: "text", text: "I paused while generating files." }],
    "orphaned tool_use blocks should be stripped from stored assistant history",
  );

  const toolOnlyPauseMessage = {
    ...pauseTurnMessage,
    content: [
      {
        type: "server_tool_use",
        id: "tool_only",
        name: "code_execution",
        input: { script: "print('tool-only')" },
      },
    ],
  } as unknown as Anthropic.Beta.BetaMessage;
  const strippedToolOnly = appendAssistantTurn(baseMessages, toolOnlyPauseMessage);
  assert.deepEqual(strippedToolOnly[1]?.content, [
    {
      type: "text",
      text: "[Basquio note: tool execution was interrupted before tool results were returned. Resume from the current container state.]",
    },
  ]);

  const continued = appendPauseTurnContinuation(baseMessages, pauseTurnMessage);
  assert.equal(continued.length, 3);
  assert.equal(continued[1]?.role, "assistant");
  assert.equal(continued[2]?.role, "user");
  assert.deepEqual(continued[2]?.content, [
    {
      type: "text",
      text: getPauseTurnContinuationText(),
    },
  ]);

  process.stdout.write("anthropic message thread regressions passed\n");
}

main();
