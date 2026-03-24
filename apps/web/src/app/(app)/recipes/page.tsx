import Link from "next/link";

import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Recipe = {
  id: string;
  name: string;
  description: string | null;
  report_type: string | null;
  target_slide_count: number;
  created_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

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
        select: "id,name,description,report_type,target_slide_count,created_at",
        user_id: `eq.${userId}`,
        order: "created_at.desc",
        limit: "20",
      },
    });
  } catch {
    return [];
  }
}

export default async function RecipesPage() {
  const viewer = await getViewerState();
  const recipes = viewer.user?.id ? await listRecipes(viewer.user.id) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Recipes</h1>
        <Link className="button" href="/jobs/new">New report</Link>
      </section>

      {recipes.length === 0 ? (
        <section className="panel workspace-empty-card">
          <div className="stack">
            <h2>No saved recipes yet</h2>
            <p className="muted">
              After generating a report, save it as a recipe to rerun next month with new data.
              Same brief, same template, same slide count — just upload fresh files.
            </p>
          </div>
          <Link className="button" href="/jobs/new">Generate your first report</Link>
        </section>
      ) : (
        <div className="recipe-grid">
          {recipes.map((recipe) => (
            <article key={recipe.id} className="panel recipe-card">
              <div className="stack-xs">
                <p className="artifact-kind">Recipe</p>
                <h3>{recipe.name}</h3>
                {recipe.description ? <p className="muted">{recipe.description}</p> : null}
              </div>

              <div className="compact-meta-row">
                <span className="run-pill">{formatDate(recipe.created_at)}</span>
                <span className="run-pill">{recipe.target_slide_count} slides</span>
                <span className="run-pill">{3 + recipe.target_slide_count} credits</span>
              </div>

              <Link className="button" href={`/jobs/new?recipe=${recipe.id}`}>
                Run with new data
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
