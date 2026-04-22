import assert from "node:assert/strict";

import { enforceDeckBudget } from "../packages/workflows/src/cost-guard";

type FakeCountTokens = () => Promise<{ input_tokens: number }>;

function buildClient(countTokens: FakeCountTokens) {
  return {
    beta: {
      messages: {
        countTokens,
      },
    },
  } as const;
}

async function main() {
  let countTokensCalls = 0;
  const serverToolResult = await enforceDeckBudget({
    client: buildClient(async () => {
      countTokensCalls += 1;
      throw new Error("countTokens should not be called for server-tool requests");
    }) as never,
    model: "claude-sonnet-4-6",
    betas: [],
    spentUsd: 0,
    outputTokenBudget: 8_000,
    maxUsd: 50,
    fileBackedBudgetContext: {
      phase: "revise",
      targetSlideCount: 30,
      fileCount: 1,
      attachmentKinds: ["xlsx"],
      hasWorkspaceContext: false,
      priorSpendUsd: 0,
    },
    body: {
      system: "test",
      messages: [{ role: "user", content: [{ type: "text", text: "repair deck" }] }],
      tools: [{ type: "web_fetch_20260209", name: "web_fetch" }] as never,
    },
  });
  assert.equal(countTokensCalls, 0);
  assert.equal(serverToolResult.usedCountTokens, false);
  assert.equal(serverToolResult.inputTokens, null);

  let fallbackCalls = 0;
  const fallbackResult = await enforceDeckBudget({
    client: buildClient(async () => {
      fallbackCalls += 1;
      throw new Error(
        "400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Server tools are not supported in the count_tokens endpoint: code_execution_20260120, web_fetch_20260209. Use the /v1/messages endpoint instead.\"}}",
      );
    }) as never,
    model: "claude-sonnet-4-6",
    betas: [],
    spentUsd: 0,
    outputTokenBudget: 8_000,
    maxUsd: 50,
    fileBackedBudgetContext: {
      phase: "revise",
      targetSlideCount: 30,
      fileCount: 1,
      attachmentKinds: ["xlsx"],
      hasWorkspaceContext: false,
      priorSpendUsd: 0,
    },
    body: {
      system: "test",
      messages: [{ role: "user", content: [{ type: "text", text: "repair deck" }] }],
    },
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(fallbackResult.usedCountTokens, false);
  assert.equal(fallbackResult.inputTokens, null);

  console.log("test-cost-guard: ok");
}

void main();
