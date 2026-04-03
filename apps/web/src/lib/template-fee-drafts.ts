import { fetchRestRows, patchRestRows } from "@/lib/supabase/admin";

export type TemplateFeeDraftStatus = "pending_payment" | "paid" | "consumed" | "cancelled" | "expired";

export type TemplateFeeDraftRow = {
  id: string;
  user_id: string;
  organization_id: string;
  project_id: string;
  template_profile_id: string;
  source_file_ids: string[];
  brief: {
    businessContext?: string;
    client?: string;
    audience?: string;
    objective?: string;
    thesis?: string;
    stakes?: string;
  };
  target_slide_count: number;
  author_model: "claude-sonnet-4-6" | "claude-opus-4-6" | "claude-haiku-4-5";
  recipe_id: string | null;
  status: TemplateFeeDraftStatus;
  stripe_checkout_session_id: string | null;
  paid_at: string | null;
  consumed_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export async function getTemplateFeeDraft(input: {
  supabaseUrl: string;
  serviceKey: string;
  draftId: string;
  userId: string;
}) {
  const rows = await fetchRestRows<TemplateFeeDraftRow>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "template_fee_checkout_drafts",
    query: {
      select: "id,user_id,organization_id,project_id,template_profile_id,source_file_ids,brief,target_slide_count,author_model,recipe_id,status,stripe_checkout_session_id,paid_at,consumed_at,expires_at,created_at,updated_at",
      id: `eq.${input.draftId}`,
      user_id: `eq.${input.userId}`,
      limit: "1",
    },
  }).catch(() => []);

  return rows[0] ?? null;
}

export async function updateTemplateFeeDraft(input: {
  supabaseUrl: string;
  serviceKey: string;
  draftId: string;
  userId: string;
  patch: Record<string, unknown>;
}) {
  const rows = await patchRestRows<TemplateFeeDraftRow>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "template_fee_checkout_drafts",
    query: {
      id: `eq.${input.draftId}`,
      user_id: `eq.${input.userId}`,
    },
    payload: {
      ...input.patch,
      updated_at: new Date().toISOString(),
    },
    select: "id,user_id,organization_id,project_id,template_profile_id,source_file_ids,brief,target_slide_count,author_model,recipe_id,status,stripe_checkout_session_id,paid_at,consumed_at,expires_at,created_at,updated_at",
  });

  return rows[0] ?? null;
}
