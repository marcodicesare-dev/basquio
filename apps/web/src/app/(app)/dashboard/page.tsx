import { BASQUIO_PIPELINE_STAGES } from "@basquio/core";

import { StatusCard } from "@/components/status-card";

export default function DashboardPage() {
  return (
    <div className="grid">
      <section className="panel stack">
        <p className="eyebrow">Dashboard</p>
        <h1>Execution surface for Basquio generation jobs.</h1>
        <p className="muted">
          This first pass exposes the pipeline shape, not final production operations tooling. The key goal is keeping
          ingest, intelligence, rendering, and delivery separated cleanly.
        </p>
      </section>

      <section className="grid cards">
        <StatusCard title="Organizations" value="Supabase" detail="Multi-tenant tables scaffolded under Basquio/supabase." />
        <StatusCard title="Jobs" value="Durable" detail="Inngest function includes typed steps from parse through storage." />
        <StatusCard title="Artifacts" value="Dual output" detail="PPTX and PDF are produced from the same slide plan." />
      </section>

      <section className="panel stack">
        <p className="eyebrow">Current stages</p>
        <ul className="clean">
          {BASQUIO_PIPELINE_STAGES.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
