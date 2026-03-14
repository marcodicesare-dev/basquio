import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { getViewerState } from "@/lib/supabase/auth";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerState();

  return <AppShell viewer={viewer}>{viewer.user ? children : <AuthGate configured={viewer.configured} />}</AppShell>;
}
