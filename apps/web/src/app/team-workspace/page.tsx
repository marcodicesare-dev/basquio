import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Team Workspace",
  description: "Team Workspace gives recurring market research teams shared memory, projects, review history, and onboarding.",
};

export default function TeamWorkspacePage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">Team Workspace</p>
        <h1>Shared memory for teams that ship research every month.</h1>
        <p>
          From $500 per month. Built for shared projects, roles, review history, onboarding, and normal
          team usage during a pilot.
        </p>
        <Link className="button" href="/get-started">Plan a team pilot</Link>
      </section>
      <section className="mstudio-system">
        <div className="mstudio-system-node">Projects</div>
        <div className="mstudio-system-node">Roles</div>
        <div className="mstudio-system-node active">Shared memory</div>
        <div className="mstudio-system-node">Review history</div>
        <div className="mstudio-system-node output">Pilot output</div>
      </section>
      <PublicSiteFooterCta
        eyebrow="Team pilot"
        title="Use Team Workspace when the knowledge is shared."
        primaryLabel="Talk about Team Workspace"
        primaryHref="/get-started"
        secondaryLabel="See security"
        secondaryHref="/security"
      />
      <PublicSiteFooter />
    </div>
  );
}
