import { describe, expect, it } from "vitest";

import { buildClaudeTools } from "./anthropic-execution-contract";

describe("buildClaudeTools", () => {
  it("returns no tools for Opus when web fetch is off", () => {
    expect(buildClaudeTools("claude-opus-4-7", { webFetchMode: "off" })).toEqual([]);
  });

  it("returns web_fetch for Opus when web fetch is enabled", () => {
    expect(buildClaudeTools("claude-opus-4-7", { webFetchMode: "enrich" })).toEqual([
      { type: "web_fetch_20260209", name: "web_fetch" },
    ]);
  });

  it("keeps explicit code execution for Haiku when web fetch is off", () => {
    expect(buildClaudeTools("claude-haiku-4-5", { webFetchMode: "off" })).toEqual([
      { type: "code_execution_20250825", name: "code_execution" },
    ]);
  });
});
