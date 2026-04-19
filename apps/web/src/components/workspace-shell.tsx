import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import type { ViewerState } from "@/lib/supabase/auth";

export function WorkspaceShell({
  viewer,
  children,
}: {
  viewer: ViewerState;
  children: ReactNode;
}) {
  const userEmail = viewer.user?.email ?? "";

  return (
    <div className="wbeta-frame">
      <header className="wbeta-topbar">
        <div className="wbeta-topbar-brand">
          <Link href="/workspace" className="wbeta-brand-lockup" aria-label="Workspace home">
            <Image
              src="/brand/svg/logo/basquio-logo-light-bg-blue.svg"
              alt="Basquio"
              width={132}
              height={22}
              priority
            />
            <span className="wbeta-pill">Workspace beta</span>
          </Link>
        </div>

        <div className="wbeta-topbar-account">
          <Link href="/dashboard" className="wbeta-back-link">
            Back to app
          </Link>
          {userEmail ? <span className="wbeta-account-email">{userEmail}</span> : null}
          <SignOutButton />
        </div>
      </header>

      <main className="wbeta-main">{children}</main>
    </div>
  );
}
