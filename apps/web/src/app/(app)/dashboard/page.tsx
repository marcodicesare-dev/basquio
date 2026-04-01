import Link from "next/link";

import { CreditPackShelf } from "@/components/credit-pack-shelf";
import { getViewerState } from "@/lib/supabase/auth";
import { listV2RunCards, type V2RunCard } from "@/lib/job-runs";
import { getCreditBalance, ensureFreeTierCredit } from "@/lib/credits";
import { fetchRestRows } from "@/lib/supabase/admin";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";

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
        limit: "4",
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
    return <Link className="button small" href={`/jobs/${run.id}`}>View progress</Link>;
  }
  if (run.status === "failed") {
    return <Link className="button small secondary" href={`/jobs/${run.id}`}>View details</Link>;
  }
  if (run.artifacts.length > 0) {
    return (
      <>
        {run.artifacts.map((a) => (
          <a key={a.kind} className="button small" href={a.downloadUrl}>
            {a.kind.toUpperCase()}
          </a>
        ))}
        <Link className="button small secondary" href={`/jobs/new?from=${run.id}`}>Rerun</Link>
      </>
    );
  }
  return <Link className="button small secondary" href={`/jobs/${run.id}`}>View run</Link>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running" || status === "queued") return <span className="run-pill run-pill-active">Generating</span>;
  if (status === "failed") return <span className="run-pill run-pill-failed">Failed</span>;
  if (status === "completed") return <span className="run-pill run-pill-ready">Ready</span>;
  return null;
}

export default async function DashboardPage() {
  const viewer = await getViewerState();
  const runs = await listV2RunCards(6, viewer.user?.id);
  const recipes = viewer.user?.id ? await listRecipes(viewer.user.id) : [];
  const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user?.email);

  // Get credit balance for stats
  let creditBalance = 0;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey && viewer.user?.id) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const bal = await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    creditBalance = bal.balance;
  }

  const completedRuns = runs.filter((r) => r.status === "completed");
  const totalSlides = completedRuns.reduce((sum, r) => sum + r.slideCount, 0);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Home</h1>
      </section>

      {/* Stats row */}
      <div className="billing-stats-row">
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">{hasUnlimitedUsage ? "Access" : "Credits available"}</p>
          <p className="billing-stat-value">{hasUnlimitedUsage ? "Unlimited" : creditBalance}</p>
          {!hasUnlimitedUsage ? (
            <div className="dashboard-credit-actions">
              <Link className="button small secondary" href="/billing">Buy credits</Link>
              <Link className="button small secondary" href="/pricing">Upgrade</Link>
            </div>
          ) : null}
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Completed</p>
          <p className="billing-stat-value">{completedRuns.length}</p>
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Slides</p>
          <p className="billing-stat-value">{totalSlides}</p>
        </article>
      </div>

      {!hasUnlimitedUsage ? (
        <section className="stack-lg">
          <CreditPackShelf
            tone="app"
            title="Top up this account"
            subtitle="These purchases go straight onto the signed-in account. No detour back to the marketing pricing page."
          />
        </section>
      ) : null}

      <section className="dashboard-tour-strip panel">
        <div className="stack-xs">
          <p className="section-label">New here?</p>
          <h2>Take the 60-second setup tour.</h2>
          <p className="muted">It walks through the report flow in the app, one highlight at a time.</p>
        </div>
        <Link className="button small" href="/jobs/new?tour=1">
          Start guided setup
        </Link>
      </section>

      {/* Recipes */}
      {recipes.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Saved recipes</h2>
            <Link className="button small secondary" href="/recipes">All recipes</Link>
          </div>
          <div className="recipe-grid">
            {recipes.map((recipe) => (
              <article key={recipe.id} className="panel recipe-card">
                <div className="stack-xs">
                  <p className="artifact-kind">Recipe</p>
                  <h3>{recipe.name}</h3>
                </div>
                <Link className="button small" href={`/jobs/new?recipe=${recipe.id}`}>
                  Run with new data
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Recent reports */}
      {runs.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Recent reports</h2>
            <Link className="button small secondary" href="/artifacts">All reports</Link>
          </div>
          <div className="presentation-list">
            {runs.map((run) => (
              <article key={run.id} className="panel presentation-card">
                <div className="presentation-card-head">
                  <div className="stack">
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
                  <StatusBadge status={run.status} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel workspace-empty-card">
          <div className="stack">
            <h2>Generate your first report</h2>
            <p className="muted">Upload your evidence files, write a brief, and Basquio builds a consulting-grade PPTX, report, and data workbook.</p>
          </div>
          <Link className="button small" href="/jobs/new">Create a report</Link>
        </section>
      )}
    </div>
  );
}
