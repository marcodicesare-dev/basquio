import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewerState: vi.fn(),
  isTeamBetaEmail: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  getScope: vi.fn(),
  buildSuggestions: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({
  getViewerState: mocks.getViewerState,
}));

vi.mock("@/lib/team-beta", () => ({
  isTeamBetaEmail: mocks.isTeamBetaEmail,
}));

vi.mock("@/lib/workspace/workspaces", () => ({
  getCurrentWorkspace: mocks.getCurrentWorkspace,
}));

vi.mock("@/lib/workspace/scopes", () => ({
  getScope: mocks.getScope,
}));

vi.mock("@/lib/workspace/suggestions", () => ({
  buildSuggestions: mocks.buildSuggestions,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getViewerState.mockReset();
  mocks.isTeamBetaEmail.mockReset();
  mocks.getCurrentWorkspace.mockReset();
  mocks.getScope.mockReset();
  mocks.buildSuggestions.mockReset();
  mocks.getViewerState.mockResolvedValue({
    user: { id: "user-1", email: "marco@example.com" },
  });
  mocks.isTeamBetaEmail.mockReturnValue(true);
  mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1" });
  mocks.getScope.mockResolvedValue({
    id: "scope-1",
    workspace_id: "workspace-1",
    name: "Lavazza",
  });
  mocks.buildSuggestions.mockResolvedValue([
    {
      id: "s1",
      kind: "summarize",
      prompt: "Summarize findings in the latest coffee file.",
      reason: "Indexed recently.",
      ctaLabel: "Summarize",
    },
  ]);
});

describe("GET /api/workspace/chat/suggestions", () => {
  it("returns scoped first-turn suggestions", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspace/chat/suggestions?workspace_id=workspace-1&scope_id=scope-1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      suggestions: [
        {
          label: "Summarize",
          prompt: "Summarize findings in the latest coffee file.",
          reason: "Indexed recently.",
        },
      ],
    });
    expect(mocks.buildSuggestions).toHaveBeenCalledWith({
      maxItems: 3,
      scopeId: "scope-1",
      scopeName: "Lavazza",
    });
  });

  it("rejects a workspace mismatch", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspace/chat/suggestions?workspace_id=other-workspace"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workspace not found." });
    expect(mocks.buildSuggestions).not.toHaveBeenCalled();
  });
});
