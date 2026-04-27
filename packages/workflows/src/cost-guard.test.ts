import { describe, expect, it } from "vitest";

import { enforceDeckBudget, getDeckPhaseBudgetCap, shouldResetCrossAttemptBudget } from "./cost-guard";

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

describe("cost-guard", () => {
  it("does not call countTokens on server-tool requests", async () => {
    let countTokensCalls = 0;
    const result = await enforceDeckBudget({
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
    expect(countTokensCalls).toBe(0);
    expect(result.usedCountTokens).toBe(false);
    expect(result.inputTokens).toBe(null);
  });

  it("falls back gracefully when countTokens rejects server-tool body with 400", async () => {
    let fallbackCalls = 0;
    const result = await enforceDeckBudget({
      client: buildClient(async () => {
        fallbackCalls += 1;
        throw new Error(
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Server tools are not supported in the count_tokens endpoint: code_execution_20260120, web_fetch_20260209. Use the /v1/messages endpoint instead."}}',
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
    expect(fallbackCalls).toBe(1);
    expect(result.usedCountTokens).toBe(false);
    expect(result.inputTokens).toBe(null);
  });

  it("resets cross-attempt budget only for operator and manual recovery reasons", () => {
    expect(shouldResetCrossAttemptBudget("operator_after_brief_data_reconciliation")).toBe(true);
    expect(shouldResetCrossAttemptBudget("manual_prod_rerun_after_deploy")).toBe(true);
    expect(shouldResetCrossAttemptBudget("visual_qa_retry")).toBe(false);
    expect(shouldResetCrossAttemptBudget(null)).toBe(false);
  });

  it("uses the hard cap for revise preflight so publishable repairs can run", () => {
    expect(getDeckPhaseBudgetCap({
      model: "claude-sonnet-4-6",
      phase: "author",
      targetSlideCount: 10,
    })).toBe(7);
    expect(getDeckPhaseBudgetCap({
      model: "claude-sonnet-4-6",
      phase: "revise",
      targetSlideCount: 10,
    })).toBe(10);
  });
});
