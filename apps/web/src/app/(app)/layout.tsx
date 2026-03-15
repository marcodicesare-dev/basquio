import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { buildSignInPath } from "@/lib/supabase/auth";
import { getViewerState } from "@/lib/supabase/auth";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerState();

  if (!viewer.configured) {
    return (
      <div className="page-shell public-page">
        <AuthGate configured={false} />
      </div>
    );
  }

  if (!viewer.user) {
    redirect(buildSignInPath("/dashboard"));
  }

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
