import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { buildSignInPath, getViewerState } from "@/lib/supabase/auth";
import { isTeamBetaEmail } from "@/lib/team-beta";

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

  return <WorkspaceShell viewer={viewer}>{children}</WorkspaceShell>;
}
