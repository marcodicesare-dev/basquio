import { describe, expect, it } from "vitest";

import {
  assertAuthoringExecutionContract,
  buildAuthoringToolCallSummary,
  buildClaudeTools,
} from "./anthropic-execution-contract";

describe("buildClaudeTools", () => {
  it("keeps explicit code execution for Opus when web fetch is off", () => {
    expect(buildClaudeTools("claude-opus-4-7", { webFetchMode: "off" })).toEqual([
      { type: "code_execution_20250825", name: "code_execution" },
    ]);
  });

  it("returns web_fetch only for Opus when web fetch is enabled", () => {
    expect(buildClaudeTools("claude-opus-4-7", { webFetchMode: "enrich" })).toEqual([
      { type: "web_fetch_20260209", name: "web_fetch" },
    ]);
  });

  it("keeps explicit code execution for Haiku when web fetch is off", () => {
    expect(buildClaudeTools("claude-haiku-4-5", { webFetchMode: "off" })).toEqual([
      { type: "code_execution_20250825", name: "code_execution" },
    ]);
  });

  it("returns code execution plus web_fetch for Haiku when web fetch is enabled", () => {
    expect(buildClaudeTools("claude-haiku-4-5", { webFetchMode: "enrich" })).toEqual([
      { type: "code_execution_20250825", name: "code_execution" },
      { type: "web_fetch_20260209", name: "web_fetch", allowed_callers: ["direct"] },
    ]);
  });
});

describe("buildAuthoringToolCallSummary", () => {
  it("records explicit code execution for author runs with web fetch off", () => {
    expect(buildAuthoringToolCallSummary("claude-opus-4-7", { webFetchMode: "off" })).toEqual({
      tools: ["code_execution"],
      autoInjectedTools: [],
      skills: ["pptx"],
    });
  });

  it("records auto-injected code execution for Sonnet or Opus enrich runs", () => {
    expect(buildAuthoringToolCallSummary("claude-opus-4-7", { webFetchMode: "enrich" })).toEqual({
      tools: ["web_fetch"],
      autoInjectedTools: ["code_execution"],
      skills: ["pptx"],
    });
  });
});

describe("assertAuthoringExecutionContract", () => {
  it("accepts the no-web-fetch authoring contract for Opus", () => {
    expect(() =>
      assertAuthoringExecutionContract({
        model: "claude-opus-4-7",
        phase: "author",
        tools: buildClaudeTools("claude-opus-4-7", { webFetchMode: "off" }),
        skills: ["pptx"],
        webFetchMode: "off",
      }),
    ).not.toThrow();
  });

  it("accepts the enrich contract for Opus", () => {
    expect(() =>
      assertAuthoringExecutionContract({
        model: "claude-opus-4-7",
        phase: "author",
        tools: buildClaudeTools("claude-opus-4-7", { webFetchMode: "enrich" }),
        skills: ["pptx"],
        webFetchMode: "enrich",
      }),
    ).not.toThrow();
  });

  it("fails fast when web-fetch-off runs omit explicit code execution", () => {
    expect(() =>
      assertAuthoringExecutionContract({
        model: "claude-opus-4-7",
        phase: "author",
        tools: [],
        skills: ["pptx"],
        webFetchMode: "off",
      }),
    ).toThrow(/without web_fetch must include the explicit code_execution tool/i);
  });

  it("fails fast when enrich runs explicitly include code execution", () => {
    expect(() =>
      assertAuthoringExecutionContract({
        model: "claude-opus-4-7",
        phase: "author",
        tools: [
          { type: "code_execution_20250825", name: "code_execution" },
          { type: "web_fetch_20260209", name: "web_fetch" },
        ],
        skills: ["pptx"],
        webFetchMode: "enrich",
      }),
    ).toThrow(/must not explicitly include code_execution/i);
  });
});
