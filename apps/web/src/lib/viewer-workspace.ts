import { fetchRestRows, upsertRestRows } from "@/lib/supabase/admin";
import type { ViewerState } from "@/lib/supabase/auth";

export const DEFAULT_PROJECT_SLUG = "default-workspace";

export type ViewerWorkspace = {
  organizationId: string;
  projectId: string;
  organizationRowId: string;
  projectRowId: string;
};

export async function ensureViewerWorkspace(user: NonNullable<ViewerState["user"]>): Promise<ViewerWorkspace | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const organizationSlug = buildOrganizationSlug(user.id);
  const organizationName = buildWorkspaceName(user.email);

  const organizations = await upsertRestRows<{ id: string }>({
    supabaseUrl,
    serviceKey,
    table: "organizations",
    onConflict: "slug",
    select: "id",
    rows: [
      {
        slug: organizationSlug,
        name: organizationName,
      },
    ],
  });

  if (!organizations[0]?.id) {
    return null;
  }

  const [, projects] = await Promise.all([
    upsertRestRows({
      supabaseUrl,
      serviceKey,
      table: "organization_memberships",
      onConflict: "organization_id,user_id",
      rows: [
        {
          organization_id: organizations[0].id,
          user_id: user.id,
          role: "owner",
        },
      ],
    }),
    upsertRestRows<{ id: string }>({
      supabaseUrl,
      serviceKey,
      table: "projects",
      onConflict: "organization_id,slug",
      select: "id",
      rows: [
        {
          organization_id: organizations[0].id,
          slug: DEFAULT_PROJECT_SLUG,
          name: "Default workspace",
          objective: "Generate executive-grade evidence packages",
          audience: "Authenticated Basquio workspace",
        },
      ],
    }),
  ]);

  if (!projects[0]?.id) {
    return null;
  }

  return {
    organizationId: organizationSlug,
    projectId: DEFAULT_PROJECT_SLUG,
    organizationRowId: organizations[0].id,
    projectRowId: projects[0].id,
  };
}

/**
 * Resolve the organization row ID for the current viewer.
 * Looks up org membership by user ID. Returns null if not found.
 */
export async function resolveViewerOrgId(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const memberships = await fetchRestRows<{ organization_id: string }>({
    supabaseUrl,
    serviceKey,
    table: "organization_memberships",
    query: {
      select: "organization_id",
      user_id: `eq.${userId}`,
      limit: "1",
    },
  }).catch(() => []);

  return memberships[0]?.organization_id ?? null;
}

export function buildOrganizationSlug(userId: string) {
  return `user-${userId}`.toLowerCase();
}

function buildWorkspaceName(email: string | null) {
  if (!email) {
    return "Basquio workspace";
  }

  const localPart = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();

  if (!localPart) {
    return "Basquio workspace";
  }

  return `${titleCase(localPart)} workspace`;
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
