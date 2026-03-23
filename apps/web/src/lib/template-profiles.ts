import { fetchRestRows } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveOwnedTemplateProfileId(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  templateProfileId: string | null | undefined;
}) {
  const { templateProfileId } = input;

  if (!templateProfileId) {
    return null;
  }

  if (!UUID_RE.test(templateProfileId)) {
    throw new Error("Invalid template profile ID.");
  }

  const rows = await fetchRestRows<{ id: string }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "template_profiles",
    query: {
      select: "id",
      id: `eq.${templateProfileId}`,
      organization_id: `eq.${input.organizationId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (!rows[0]?.id) {
    throw new Error("Template profile not found.");
  }

  return rows[0].id;
}
