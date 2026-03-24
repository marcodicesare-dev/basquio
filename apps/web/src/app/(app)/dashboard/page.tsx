import Link from "next/link";

import { getViewerState } from "@/lib/supabase/auth";
import { listV2RunCards, type V2RunCard } from "@/lib/job-runs";
import { fetchRestRows } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Recipe = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

async function listRecipes(userId: string): Promise<Recipe[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  try {
    return await fetchRestRows<Recipe>({
      supabaseUrl,
      serviceKey,
      table: "recipes",
      query: {
        select: "id,name,description,created_at",
        user_id: `eq.${userId}`,
        order: "created_at.desc",
        limit: "5",
      },
    });
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function RunActions({ run }: { run: V2RunCard }) {
  if (run.status === "running" || run.status === "queued") {
    return <Link className="button" href={`/jobs/${run.id}`}>View progress</Link>;
  }
  if (run.status === "failed") {
    return <Link className="button secondary" href={`/jobs/${run.id}`}>View details</Link>;
  }
  if (run.artifacts.length > 0) {
    return (
      <>
        {run.artifacts.map((a) => (
          <a key={a.kind} className="button" href={a.downloadUrl}>
            Download {a.kind.toUpperCase()}
          </a>
        ))}
        <Link className="button secondary" href={`/jobs/new?from=${run.id}`}>
          Rerun
        </Link>
      </>
    );
  }
  return <Link className="button secondary" href={`/jobs/${run.id}`}>View run</Link>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running" || status === "queued") return <span className="run-pill run-pill-active">Generating...</span>;
  if (status === "failed") return <span className="run-pill run-pill-failed">Failed</span>;
  if (status === "completed") return <span className="run-pill run-pill-ready">Ready</span>;
  return null;
}

function CostBadge({ run }: { run: V2RunCard }) {
  if (!run.costUsd) return null;
  const credits = 3 + run.slideCount;
  return <span className="run-pill">{credits} credits</span>;
}

export default async function DashboardPage() {
  const viewer = await getViewerState();
  const runs = await listV2RunCards(8, viewer.user?.id);
  const recipes = viewer.user?.id ? await listRecipes(viewer.user.id) : [];
  const latestRun = runs[0] ?? null;
  const recentRuns = latestRun ? runs.slice(1, 5) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Dashboard</h1>
        <Link className="button" href="/jobs/new">New report</Link>
      </section>

      {latestRun ? (
        <section className="panel featured-analysis-card stack-xl">
          <div className="run-card-head">
            <div className="stack">
              <p className="artifact-kind">Latest report</p>
              <h2>{latestRun.headline}</h2>
              <p className="muted">
                {[latestRun.client, latestRun.objective].filter(Boolean).join(" — ")}
              </p>
            </div>
            <div className="row">
              <RunActions run={latestRun} />
            </div>
          </div>
          <div className="compact-meta-row">
            <span className="run-pill">{formatDate(latestRun.createdAt)}</span>
            <span className="run-pill">{latestRun.sourceFileName}</span>
            {latestRun.slideCount > 0 ? <span className="run-pill">{latestRun.slideCount} slides</span> : null}
            <CostBadge run={latestRun} />
            <StatusBadge status={latestRun.status} />
          </div>
        </section>
      ) : (
        <section className="panel workspace-empty-card onboarding-card">
          <div className="stack">
            <h2>6 free credits to start</h2>
            <p className="muted">Enough for one 3-slide executive brief. Upload your data, pick a report type, and see the output before you buy.</p>
          </div>
          <div className="onboarding-steps">
            <div className="onboarding-step">
              <span className="onboarding-step-number">1</span>
              <div className="stack-xs">
                <strong>Pick a report type</strong>
                <p className="muted">Category review, growth diagnosis, channel performance, or custom.</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">2</span>
              <div className="stack-xs">
                <strong>Upload your data</strong>
                <p className="muted">CSVs, spreadsheets, and supporting documents. NielsenIQ and Circana exports work out of the box.</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">3</span>
              <div className="stack-xs">
                <strong>Get PPTX + PDF</strong>
                <p className="muted">Download an editable deck and a polished PDF from the same analysis.</p>
              </div>
            </div>
          </div>
          <Link className="button" href="/jobs/new">Generate my first deck free</Link>
        </section>
      )}

      {recipes.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Saved recipes</h2>
          </div>
          <div className="recipe-grid">
            {recipes.map((recipe) => (
              <article key={recipe.id} className="panel recipe-card">
                <div className="stack-xs">
                  <p className="artifact-kind">Recipe</p>
                  <h3>{recipe.name}</h3>
                  {recipe.description ? <p className="muted">{recipe.description}</p> : null}
                </div>
                <Link className="button" href={`/jobs/new?recipe=${recipe.id}`}>
                  Run with new data
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {recentRuns.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Recent reports</h2>
            <Link className="button secondary" href="/artifacts">All reports</Link>
          </div>
          <div className="presentation-list">
            {recentRuns.map((run) => (
              <article key={run.id} className="panel presentation-card">
                <div className="presentation-card-head">
                  <div className="stack">
                    <p className="artifact-kind">{run.sourceFileName}</p>
                    <h3>{run.headline}</h3>
                    <p className="muted">{[run.client, run.objective].filter(Boolean).join(" — ")}</p>
                  </div>
                  <div className="download-actions">
                    <RunActions run={run} />
                  </div>
                </div>
                <div className="compact-meta-row">
                  <span className="run-pill">{formatDate(run.createdAt)}</span>
                  {run.slideCount > 0 ? <span className="run-pill">{run.slideCount} slides</span> : null}
                  <CostBadge run={run} />
                  <StatusBadge status={run.status} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
