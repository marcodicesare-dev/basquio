import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { buildSignInPath, getViewerState } from "@/lib/supabase/auth";
import { ensureFreeTierCredit, getCreditBalance } from "@/lib/credits";
import { isTeamBetaEmail } from "@/lib/team-beta";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { countByScope, listScopesGrouped, type ScopeCounts } from "@/lib/workspace/scopes";

export const metadata = {
  title: "Workspace · Basquio",
};

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerState();

  if (!viewer.configured) {
    notFound();
  }

  if (!viewer.user) {
    const headersList = await headers();
    const currentPath = headersList.get("x-next-url") ?? headersList.get("x-invoke-path") ?? "/workspace";
    redirect(buildSignInPath(currentPath));
  }

  if (!isTeamBetaEmail(viewer.user.email)) {
    notFound();
  }

  const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user.email);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let creditBalance = -1;
  if (!hasUnlimitedUsage && supabaseUrl && serviceKey) {
    const [granted, balance] = await Promise.all([
      ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id }),
      getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id }),
    ]);
    creditBalance = granted
      ? (await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id })).balance
      : balance.balance;
  }

  const [scopeTree, countsMap] = await Promise.all([
    listScopesGrouped().catch(() => ({ client: [], category: [], function: [], system: [] })),
    countByScope().catch(() => new Map<string, ScopeCounts>()),
  ]);

  const scopeCounts: Record<string, ScopeCounts> = {};
  for (const [id, row] of countsMap) {
    scopeCounts[id] = row;
  }

  return (
    <WorkspaceShell
      viewer={viewer}
      scopeTree={scopeTree}
      scopeCounts={scopeCounts}
      creditBalance={creditBalance}
    >
      {children}
    </WorkspaceShell>
  );
}
