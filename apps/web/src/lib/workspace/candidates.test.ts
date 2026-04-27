import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabase = vi.hoisted(() => {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    gt: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    _result: { data: unknown; error: unknown };
  } = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    _result: { data: null, error: null },
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
  mockSupabase.builder.gt.mockClear();
  mockSupabase.builder.order.mockClear();
  mockSupabase.builder.limit.mockClear();
  mockSupabase.builder.select.mockClear();
});

describe("listPendingCandidates", () => {
  it("filters by workspace + status='pending' + non-expired and orders newest first", async () => {
    const { listPendingCandidates } = await import("./candidates");
    mockSupabase.setResult({ data: [], error: null });
    await listPendingCandidates("workspace-uuid");
    expect(mockSupabase.from).toHaveBeenCalledWith("memory_candidates");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("workspace_id", "workspace-uuid");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("status", "pending");
    expect(mockSupabase.builder.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(mockSupabase.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("filters scope_id to NULL when scopeId=null is passed explicitly", async () => {
    const { listPendingCandidates } = await import("./candidates");
    mockSupabase.setResult({ data: [], error: null });
    await listPendingCandidates("workspace-uuid", null);
    expect(mockSupabase.builder.is).toHaveBeenCalledWith("scope_id", null);
  });

  it("filters scope_id by value when a scopeId string is provided", async () => {
    const { listPendingCandidates } = await import("./candidates");
    mockSupabase.setResult({ data: [], error: null });
    await listPendingCandidates("workspace-uuid", "scope-uuid");
    expect(mockSupabase.builder.eq).toHaveBeenCalledWith("scope_id", "scope-uuid");
  });

  it("throws when supabase returns an error", async () => {
    const { listPendingCandidates } = await import("./candidates");
    mockSupabase.setResult({ data: null, error: { message: "permission denied" } });
    await expect(listPendingCandidates("workspace-uuid")).rejects.toThrow(/permission denied/);
  });
});

describe("approveCandidate / dismissCandidate / expirePendingCandidates", () => {
  it("approveCandidate calls approve_memory_candidate RPC with user actor", async () => {
    const { approveCandidate } = await import("./candidates");
    mockSupabase.rpc.mockResolvedValueOnce({ data: { kind: "fact", durable_id: "f-id" }, error: null });
    const result = await approveCandidate("c-id", "u-id", { foo: "bar" });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("approve_memory_candidate", {
      p_candidate_id: "c-id",
      p_user_id: "u-id",
      p_edits: { foo: "bar" },
      p_actor: "user:u-id",
    });
    expect(result.kind).toBe("fact");
    expect(result.durable_id).toBe("f-id");
  });

  it("dismissCandidate calls dismiss_memory_candidate RPC with reason", async () => {
    const { dismissCandidate } = await import("./candidates");
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await dismissCandidate("c-id", "u-id", "wrong predicate");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("dismiss_memory_candidate", {
      p_candidate_id: "c-id",
      p_user_id: "u-id",
      p_reason: "wrong predicate",
      p_actor: "user:u-id",
    });
  });

  it("expirePendingCandidates passes p_older_than_days as null when not provided", async () => {
    const { expirePendingCandidates } = await import("./candidates");
    mockSupabase.rpc.mockResolvedValueOnce({ data: 7, error: null });
    const count = await expirePendingCandidates();
    expect(mockSupabase.rpc).toHaveBeenCalledWith("expire_pending_candidates", {
      p_older_than_days: null,
      p_actor: "system:operator:expire-candidates",
    });
    expect(count).toBe(7);
  });
});
