import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getViewerState, type ViewerState } from "@/lib/supabase/auth";

/**
 * Memory v1 Brief 6 admin auth.
 *
 * /admin/* surfaces require a super_admin role. The check fans out
 * through `public.is_super_admin(_user_id)` (SECURITY DEFINER). The
 * legacy team-beta gate continues to apply to /workspace/* routes;
 * /admin/* is a separate, narrower set.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export type AdminViewerState =
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; viewer: ViewerState }
  | { kind: "ok"; viewer: ViewerState; userId: string; email: string | null };

export async function getAdminViewerState(): Promise<AdminViewerState> {
  const viewer = await getViewerState();
  if (!viewer.user) return { kind: "unauthenticated" };
  const db = getDb();
  const { data, error } = await db
    .from("super_admins")
    .select("user_id, email")
    .eq("user_id", viewer.user.id)
    .maybeSingle();
  if (error || !data) return { kind: "forbidden", viewer };
  return {
    kind: "ok",
    viewer,
    userId: data.user_id as string,
    email: (data.email as string | null) ?? viewer.user.email ?? null,
  };
}
