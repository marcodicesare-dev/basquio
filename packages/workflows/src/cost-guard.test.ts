import { describe, expect, it } from "vitest";

import { enforceDeckBudget, shouldResetCrossAttemptBudget } from "./cost-guard";

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

  it("resets cross-attempt budget for explicit operator recovery reruns", () => {
    expect(shouldResetCrossAttemptBudget(null)).toBe(false);
    expect(shouldResetCrossAttemptBudget("transient_provider_retry")).toBe(false);
    expect(shouldResetCrossAttemptBudget("operator_retry")).toBe(true);
    expect(shouldResetCrossAttemptBudget("manual_code_fix_rerun")).toBe(true);
    expect(shouldResetCrossAttemptBudget("rossella_after_reviewed_p0_rollback_deploy")).toBe(true);
    expect(shouldResetCrossAttemptBudget("rossella_prod_rerun_after_generated_workbook_sheet_gate_fix")).toBe(true);
  });
});
