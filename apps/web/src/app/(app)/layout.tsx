import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { getViewerState } from "@/lib/supabase/auth";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerState();

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
