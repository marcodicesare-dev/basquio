import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertDeckSpendWithinBudget,
  enforceDeckBudget,
  shouldResetCrossAttemptBudget,
} from "./cost-guard";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    expect(result.overBudget).toBe(false);
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
    expect(result.overBudget).toBe(false);
  });

  it("warns and reports anomalies above the soft cap without throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSoftCapExceeded = vi.fn();

    const result = await enforceDeckBudget({
      client: buildClient(async () => ({ input_tokens: 1_000_000 })) as never,
      model: "claude-opus-4-7",
      betas: [],
      spentUsd: 0,
      outputTokenBudget: 400_000,
      maxUsd: 12,
      body: {
        system: "test",
        messages: [{ role: "user", content: [{ type: "text", text: "author deck" }] }],
      },
      onSoftCapExceeded,
    });

    expect(result.projectedUsd).toBe(15);
    expect(result.overBudget).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(onSoftCapExceeded).toHaveBeenCalledWith({
      model: "claude-opus-4-7",
      projectedUsd: 15,
      softCapUsd: 12,
      spentUsd: 0,
    });
  });

  it("throws when the projected spend exceeds the emergency ceiling", async () => {
    await expect(enforceDeckBudget({
      client: buildClient(async () => ({ input_tokens: 2_000_000 })) as never,
      model: "claude-opus-4-7",
      betas: [],
      spentUsd: 0,
      outputTokenBudget: 840_000,
      maxUsd: 12,
      body: {
        system: "test",
        messages: [{ role: "user", content: [{ type: "text", text: "author deck" }] }],
      },
    })).rejects.toThrow(/emergency ceiling/i);
  });

  it("keeps actual spend under soft cap without anomaly logging", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = assertDeckSpendWithinBudget(4, 12, {
      context: "revise",
      allowPartialOutput: true,
    });

    expect(result.overBudget).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resets cross-attempt budget for operator prod reruns after a fix", () => {
    expect(shouldResetCrossAttemptBudget("rossella_prod_rerun_after_publish_path_fix")).toBe(true);
    expect(shouldResetCrossAttemptBudget("manual_code_fix_rerun")).toBe(true);
  });

  it("keeps cross-attempt budget active for normal and transient retries", () => {
    expect(shouldResetCrossAttemptBudget(null)).toBe(false);
    expect(shouldResetCrossAttemptBudget("transient_provider_retry")).toBe(false);
    expect(shouldResetCrossAttemptBudget("worker_shutdown")).toBe(false);
  });
});
