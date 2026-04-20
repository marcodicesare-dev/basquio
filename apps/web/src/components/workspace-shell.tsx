import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import type { ViewerState } from "@/lib/supabase/auth";
import type { ScopeCounts, ScopeTree } from "@/lib/workspace/scopes";

export function WorkspaceShell({
  viewer,
  scopeTree,
  scopeCounts,
  children,
}: {
  viewer: ViewerState;
  scopeTree: ScopeTree;
  scopeCounts: Record<string, ScopeCounts>;
  children: ReactNode;
}) {
  const userEmail = viewer.user?.email ?? "";

  return (
    <div className="wbeta-frame">
      <header className="wbeta-topbar">
        <div className="wbeta-topbar-left">
          <Link href="/workspace" className="wbeta-brand-lockup" aria-label="Workspace home">
            <Image
              src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
              alt="Basquio"
              width={108}
              height={18}
              priority
            />
            <span className="wbeta-pill">beta</span>
          </Link>
        </div>

        <div className="wbeta-topbar-right">
          <Link href="/dashboard" className="wbeta-back-link">
            App
          </Link>
          {userEmail ? (
            <span className="wbeta-account-email" title={userEmail}>
              {userEmail}
            </span>
          ) : null}
          <span className="wbeta-signout-slot">
            <SignOutButton />
          </span>
        </div>
      </header>

      <div className="wbeta-body">
        <WorkspaceSidebar tree={scopeTree} counts={scopeCounts} />
        <main className="wbeta-main">{children}</main>
      </div>
    </div>
  );
}
