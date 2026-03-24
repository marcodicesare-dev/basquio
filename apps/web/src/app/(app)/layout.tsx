import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { buildSignInPath } from "@/lib/supabase/auth";
import { getViewerState } from "@/lib/supabase/auth";
import { getCreditBalance, ensureFreeTierCredit } from "@/lib/credits";

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

  // Fetch credit balance for sidebar display
  let creditBalance = 0;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const balance = await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    creditBalance = balance.balance;
  }

  return <AppShell viewer={viewer} creditBalance={creditBalance}>{children}</AppShell>;
}
