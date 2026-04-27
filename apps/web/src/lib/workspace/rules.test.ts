import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabase = vi.hoisted(() => {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    _result: { data: unknown; error: unknown };
  } = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    _result: { data: [], error: null },
  };
  Object.defineProperty(builder, "then", {
    value: (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(builder._result).then(onFulfilled),
    enumerable: false,
  });
  return {
    from: vi.fn(() => builder),
    rpc: vi.fn(),
    builder,
    setResult(result: { data: unknown; error: unknown }) {
      builder._result = result;
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createServiceSupabaseClient: () => mockSupabase,
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  mockSupabase.from.mockClear();
  mockSupabase.rpc.mockReset();
  mockSupabase.builder.eq.mockClear();
  mockSupabase.builder.is.mockClear();
  mockSupabase.builder.or.mockClear();
  mockSupabase.builder.order.mockClear();
  mockSupabase.builder.limit.mockClear();
  mockSupabase.builder.select.mockClear();
});

describe("listActiveRules", () => {
  it("filters by workspace + active=true + expired_at IS NULL, ordered by priority desc", async () => {
    const { listActiveRules } = await import("./rules");
    mockSupabase.setResult({ data: [], error: null });
    await listActiveRules("workspace-uuid");
    expect(mockSupabase.from).toHaveBeenCalledWith("workspace_rule");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("workspace_id", "workspace-uuid");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("active", true);
    expect(mockSupabase.builder.is).toHaveBeenCalledWith("expired_at", null);
    expect(mockSupabase.builder.order).toHaveBeenCalledWith("priority", { ascending: false });
  });

  it("includes scope-specific AND workspace-wide (NULL scope) rules when scopeId is provided", async () => {
    const { listActiveRules } = await import("./rules");
    mockSupabase.setResult({ data: [], error: null });
    await listActiveRules("workspace-uuid", { scopeId: "scope-uuid" });
    expect(mockSupabase.builder.or).toHaveBeenCalledWith("scope_id.eq.scope-uuid,scope_id.is.null");
  });

  it("filters by ruleType when requested", async () => {
    const { listActiveRules } = await import("./rules");
    mockSupabase.setResult({ data: [], error: null });
    await listActiveRules("workspace-uuid", { ruleType: "always" });
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("rule_type", "always");
  });
});

describe("upsertRule / pinRule / editRule / forgetRule", () => {
  it("upsertRule calls upsert_workspace_rule RPC with the right shape", async () => {
    const { upsertRule } = await import("./rules");
    mockSupabase.rpc.mockResolvedValueOnce({ data: "rule-id", error: null });
    const id = await upsertRule({
      workspaceId: "w",
      scopeId: null,
      ruleType: "always",
      ruleText: "Cite source pages",
      origin: "user",
      actor: "user:u-id",
    });
    expect(id).toBe("rule-id");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("upsert_workspace_rule", expect.objectContaining({
      p_workspace_id: "w",
      p_rule_type: "always",
      p_rule_text: "Cite source pages",
      p_origin: "user",
      p_actor: "user:u-id",
    }));
  });

  it("pinRule calls pin_workspace_rule with user actor", async () => {
    const { pinRule } = await import("./rules");
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await pinRule("rule-id", "u-id");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("pin_workspace_rule", {
      p_rule_id: "rule-id",
      p_user_id: "u-id",
      p_actor: "user:u-id",
    });
  });

  it("editRule passes edits jsonb", async () => {
    const { editRule } = await import("./rules");
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await editRule("rule-id", "u-id", { rule_text: "new text", priority: 80 });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("edit_workspace_rule", {
      p_rule_id: "rule-id",
      p_user_id: "u-id",
      p_edits: { rule_text: "new text", priority: 80 },
      p_actor: "user:u-id",
    });
  });

  it("forgetRule calls forget_workspace_rule", async () => {
    const { forgetRule } = await import("./rules");
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await forgetRule("rule-id", "u-id");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("forget_workspace_rule", {
      p_rule_id: "rule-id",
      p_user_id: "u-id",
      p_actor: "user:u-id",
    });
  });
});

describe("formatActiveRulesForScope", () => {
  it("returns empty string for empty rules", async () => {
    const { formatActiveRulesForScope } = await import("./rules");
    expect(formatActiveRulesForScope([])).toBe("");
  });

  it("groups by rule_type and orders by priority desc within group", async () => {
    const { formatActiveRulesForScope } = await import("./rules");
    const out = formatActiveRulesForScope([
      {
        id: "1", workspace_id: "w", scope_id: null,
        rule_type: "always", rule_text: "A", applies_to: [], forbidden: [],
        origin: "user", origin_evidence: [], priority: 50, active: true,
        valid_from: null, valid_to: null, expired_at: null, confidence: 0.95,
        approved_by: null, approved_at: null, last_applied_at: null,
        metadata: {}, created_at: "", updated_at: "",
      },
      {
        id: "2", workspace_id: "w", scope_id: null,
        rule_type: "always", rule_text: "B", applies_to: [], forbidden: [],
        origin: "user", origin_evidence: [], priority: 90, active: true,
        valid_from: null, valid_to: null, expired_at: null, confidence: 0.95,
        approved_by: null, approved_at: null, last_applied_at: null,
        metadata: {}, created_at: "", updated_at: "",
      },
      {
        id: "3", workspace_id: "w", scope_id: null,
        rule_type: "never", rule_text: "C", applies_to: ["deck"], forbidden: [],
        origin: "user", origin_evidence: [], priority: 60, active: true,
        valid_from: null, valid_to: null, expired_at: null, confidence: 0.95,
        approved_by: null, approved_at: null, last_applied_at: null,
        metadata: {}, created_at: "", updated_at: "",
      },
    ] as never);
    expect(out).toContain("## Active workspace rules");
    expect(out).toContain("### always");
    expect(out).toContain("### never");
    // priority 90 ("B") should appear before priority 50 ("A")
    expect(out.indexOf("- B")).toBeLessThan(out.indexOf("- A"));
    expect(out).toContain("[applies_to: deck]");
  });
});
