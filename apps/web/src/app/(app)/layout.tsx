import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { buildSignInPath } from "@/lib/supabase/auth";
import { getViewerState } from "@/lib/supabase/auth";
import { bootstrapViewerAccount } from "@/lib/auth-bootstrap";
import { getCreditBalance, ensureFreeTierCredit } from "@/lib/credits";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";

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
    // Preserve the current path so sign-in redirects back here, not /dashboard
    const headersList = await headers();
    const currentPath = headersList.get("x-next-url") ?? headersList.get("x-invoke-path") ?? "/dashboard";
    redirect(buildSignInPath(currentPath));
  }

  try {
    await bootstrapViewerAccount(viewer.user);
  } catch (error) {
    console.warn("[basquio] viewer bootstrap failed in layout:", error);
  }

  const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user.email);

  // Fetch credit balance for sidebar display
  let creditBalance = 0;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey && !hasUnlimitedUsage) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const balance = await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    creditBalance = balance.balance;
  }

  return <AppShell viewer={viewer} creditBalance={hasUnlimitedUsage ? -1 : creditBalance}>{children}</AppShell>;
}
