import { describe, expect, it } from "vitest";

import {
  buildChatRequest,
  buildChatSystemBlocks,
  STATIC_SYSTEM_PROMPT,
} from "../agent";

describe("buildChatSystemBlocks (Memory v1 Brief 2)", () => {
  it("returns three system blocks in static -> workspace -> scope order", () => {
    const blocks = buildChatSystemBlocks({
      staticSystemPrompt: "STATIC",
      workspaceBrandPack: "WS",
      scopeContextPack: "SCOPE",
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.role).toBe("system");
    expect(blocks[0]?.content).toBe("STATIC");
    expect(blocks[1]?.content).toBe("WS");
    expect(blocks[2]?.content).toBe("SCOPE");
  });

  it("tags the static prompt with a 1-hour ephemeral cache_control", () => {
    const blocks = buildChatSystemBlocks({
      staticSystemPrompt: "S",
      workspaceBrandPack: "WS",
      scopeContextPack: "SCOPE",
    });
    const cc = (blocks[0]?.providerOptions?.anthropic as Record<string, unknown> | undefined)
      ?.cacheControl as { type?: string; ttl?: string } | undefined;
    expect(cc?.type).toBe("ephemeral");
    expect(cc?.ttl).toBe("1h");
  });

  it("tags the workspace pack with default 5-minute ephemeral cache_control", () => {
    const blocks = buildChatSystemBlocks({
      staticSystemPrompt: "S",
      workspaceBrandPack: "WS",
      scopeContextPack: "SCOPE",
    });
    const cc = (blocks[1]?.providerOptions?.anthropic as Record<string, unknown> | undefined)
      ?.cacheControl as { type?: string; ttl?: string } | undefined;
    expect(cc?.type).toBe("ephemeral");
    expect(cc?.ttl).toBeUndefined();
  });

  it("tags the scope pack with default 5-minute ephemeral cache_control", () => {
    const blocks = buildChatSystemBlocks({
      staticSystemPrompt: "S",
      workspaceBrandPack: "WS",
      scopeContextPack: "SCOPE",
    });
    const cc = (blocks[2]?.providerOptions?.anthropic as Record<string, unknown> | undefined)
      ?.cacheControl as { type?: string; ttl?: string } | undefined;
    expect(cc?.type).toBe("ephemeral");
    expect(cc?.ttl).toBeUndefined();
  });
});

describe("buildChatRequest", () => {
  it("composes the static system prompt into the first cached block", () => {
    const req = buildChatRequest({
      workspaceId: "ws-1",
      scopeId: "scope-1",
      conversationId: "conv-1",
      model: "claude-sonnet-4-6",
      workspaceBrandPack: "WS BRAND",
      scopeContextPack: "SCOPE CTX",
    });
    expect(req.model).toBe("claude-sonnet-4-6");
    expect(req.system).toHaveLength(3);
    expect(req.system[0]?.content).toBe(STATIC_SYSTEM_PROMPT);
    expect(req.system[1]?.content).toBe("WS BRAND");
    expect(req.system[2]?.content).toBe("SCOPE CTX");
    expect(req.workspaceId).toBe("ws-1");
    expect(req.scopeId).toBe("scope-1");
    expect(req.conversationId).toBe("conv-1");
  });

  it("preserves the static persona content unchanged across the rename", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("You are Basquio");
    expect(STATIC_SYSTEM_PROMPT).toContain("ALWAYS END YOUR FINAL MESSAGE WITH SUGGESTIONS");
    expect(STATIC_SYSTEM_PROMPT).not.toContain("undefined");
  });
});
