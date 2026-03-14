import Link from "next/link";

import { BASQUIO_PIPELINE_STAGES, BASQUIO_RENDER_POLICY, BASQUIO_SUPABASE } from "@basquio/core";

import { StatusCard } from "@/components/status-card";
import { getViewerState } from "@/lib/supabase/auth";

export default async function HomePage() {
  const viewer = await getViewerState();

  return (
    <div className="grid">
      <section className="panel hero stack">
        <p className="eyebrow">Basquio Foundation</p>
        <h1>Dataset understanding, evidence-backed insights, and one canonical slide plan.</h1>
        <p className="muted">
          This scaffold keeps Basquio out of the generic AI deck-generator trap. Deterministic analytics run before
          narrative planning, and both PPTX and PDF hang off the same <code>SlideSpec[]</code>.
        </p>
        <div className="row">
          <Link className="button" href="/dashboard">
            Open dashboard
          </Link>
          <Link className="button secondary" href="/sign-in">
            Sign in
          </Link>
        </div>
      </section>

      <section className="grid cards">
        <StatusCard title="Workflow runtime" value="Inngest" detail="Eight durable stages with artifact storage at the end." />
        <StatusCard title="Supabase project" value={BASQUIO_SUPABASE.projectId} detail={BASQUIO_SUPABASE.url} />
        <StatusCard
          title="Auth status"
          value={viewer.configured ? (viewer.user ? "Signed in" : "Configured") : "Placeholder mode"}
          detail={viewer.user?.email ?? "No active session yet."}
        />
      </section>

      <section className="panel stack">
        <p className="eyebrow">Pipeline</p>
        <div className="grid cards">
          {BASQUIO_PIPELINE_STAGES.map((stage) => (
            <div key={stage} className="panel compact">
              <strong>{stage}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <p className="eyebrow">Rendering policy</p>
        <ul className="clean">
          {Object.values(BASQUIO_RENDER_POLICY).map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
