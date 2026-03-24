import Link from "next/link";

import { getViewerState } from "@/lib/supabase/auth";
import { listV2RunCards } from "@/lib/job-runs";
import { ReportsList } from "@/components/reports-list";

export const dynamic = "force-dynamic";

export default async function ArtifactsPage() {
  const viewer = await getViewerState();
  const runs = await listV2RunCards(50, viewer.user?.id);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Reports</h1>
        <Link className="button" href="/jobs/new">New report</Link>
      </section>

      {runs.length === 0 ? (
        <section className="panel workspace-empty-card">
          <div className="empty-illustration" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="stack">
            <h2>No reports yet</h2>
            <p className="muted">Upload your data and Basquio will build your first report.</p>
          </div>
          <Link className="button" href="/jobs/new">Create your first report</Link>
        </section>
      ) : (
        <ReportsList runs={runs} />
      )}
    </div>
  );
}
