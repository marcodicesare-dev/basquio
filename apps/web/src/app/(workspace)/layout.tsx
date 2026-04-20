import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { buildSignInPath, getViewerState } from "@/lib/supabase/auth";
import { isTeamBetaEmail } from "@/lib/team-beta";
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

  const [scopeTree, countsMap] = await Promise.all([
    listScopesGrouped().catch(() => ({ client: [], category: [], function: [], system: [] })),
    countByScope().catch(() => new Map<string, ScopeCounts>()),
  ]);

  const scopeCounts: Record<string, ScopeCounts> = {};
  for (const [id, row] of countsMap) {
    scopeCounts[id] = row;
  }

  return (
    <WorkspaceShell viewer={viewer} scopeTree={scopeTree} scopeCounts={scopeCounts}>
      {children}
    </WorkspaceShell>
  );
}
