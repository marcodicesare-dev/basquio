import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { getViewerState } from "@/lib/supabase/auth";

export function isTeamBetaEmail(email: string | null | undefined): boolean {
  return hasUnlimitedAccess(email);
}

export async function isTeamBetaEligible(): Promise<boolean> {
  const viewer = await getViewerState();
  return isTeamBetaEmail(viewer.user?.email ?? null);
}
