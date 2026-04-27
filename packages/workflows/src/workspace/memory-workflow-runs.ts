/**
 * Memory v1 workflow-run telemetry helpers.
 *
 * Briefs 3-6 all write to public.memory_workflow_runs to record extractor /
 * promoter runs. The workflow row in public.memory_workflows is upserted
 * lazily on first run per (organization_id, name, version). Direct service-
 * role writes are fine here; memory_workflow_runs and memory_workflows are
 * NOT audited by the audit_memory_change trigger (the audit only covers
 * workspace_rule, brand_guideline, anticipation_hints, facts, memory_entries).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryWorkflowTrigger =
  | "on_upload"
  | "on_session_end"
  | "on_deliverable_edit"
  | "cron"
  | "on_deadline";

export type MemoryWorkflowRunStatus = "running" | "success" | "failure" | "cancelled";

export type EnsureMemoryWorkflowInput = {
  organizationId: string;
  name: string;
  version: number;
  triggerKind: MemoryWorkflowTrigger;
  skillRef: string;
  scheduleCron?: string | null;
  metadata?: Record<string, unknown>;
};

export async function ensureMemoryWorkflow(
  supabase: SupabaseClient,
  input: EnsureMemoryWorkflowInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("memory_workflows")
    .upsert(
      {
        organization_id: input.organizationId,
        name: input.name,
        version: input.version,
        trigger_kind: input.triggerKind,
        skill_ref: input.skillRef,
        schedule_cron: input.scheduleCron ?? null,
        active: true,
        metadata: input.metadata ?? {},
      },
      { onConflict: "organization_id,name,version" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export type BeginWorkflowRunInput = {
  workflowId: string;
  organizationId: string;
  workspaceId?: string | null;
  scopeId?: string | null;
  triggerPayload?: Record<string, unknown>;
  promptVersion?: string | null;
  skillVersion?: string | null;
};

export async function beginWorkflowRun(
  supabase: SupabaseClient,
  input: BeginWorkflowRunInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("memory_workflow_runs")
    .insert({
      workflow_id: input.workflowId,
      organization_id: input.organizationId,
      workspace_id: input.workspaceId ?? null,
      scope_id: input.scopeId ?? null,
      trigger_payload: input.triggerPayload ?? {},
      status: "running",
      prompt_version: input.promptVersion ?? null,
      skill_version: input.skillVersion ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export type FinishWorkflowRunInput = {
  status: MemoryWorkflowRunStatus;
  candidatesCreated?: number;
  hintsCreated?: number;
  rulesProposed?: number;
  costUsd?: number | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

export async function finishWorkflowRun(
  supabase: SupabaseClient,
  runId: string,
  input: FinishWorkflowRunInput,
): Promise<void> {
  const { error } = await supabase
    .from("memory_workflow_runs")
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      candidates_created: input.candidatesCreated ?? 0,
      hints_created: input.hintsCreated ?? 0,
      rules_proposed: input.rulesProposed ?? 0,
      cost_usd: input.costUsd ?? null,
      tokens_input: input.tokensInput ?? null,
      tokens_output: input.tokensOutput ?? null,
      error_message: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
    })
    .eq("id", runId);
  if (error) throw error;
}
