import { describe, expect, it } from "vitest";

import { resolveChatModel } from "./agent";

describe("resolveChatModel", () => {
  it("uses Sonnet 4.6 for standard mode", () => {
    expect(resolveChatModel("standard")).toBe("claude-sonnet-4-6");
  });

  it("uses Opus 4.7 for deep mode", () => {
    expect(resolveChatModel("deep")).toBe("claude-opus-4-7");
  });

  it("defaults to Sonnet 4.6 when no mode is provided", () => {
    expect(resolveChatModel(undefined)).toBe("claude-sonnet-4-6");
  });
});
