import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/recipes — list recipes for the authenticated user
 */
export async function GET() {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json([]);
  }

  try {
    const recipes = await fetchRestRows<{
      id: string;
      name: string;
      description: string | null;
      report_type: string | null;
      brief: Record<string, string>;
      template_profile_id: string | null;
      target_slide_count: number;
      author_model: string | null;
      source_run_id: string | null;
      created_at: string;
    }>({
      supabaseUrl,
      serviceKey,
      table: "recipes",
      query: {
        select: "id,name,description,report_type,brief,template_profile_id,target_slide_count,author_model,source_run_id,created_at",
        user_id: `eq.${viewer.user.id}`,
        order: "created_at.desc",
        limit: "20",
      },
    });

    return NextResponse.json(recipes);
  } catch {
    return NextResponse.json([]);
  }
}

/**
 * POST /api/recipes — save a recipe from a completed run
 * Body: { name, description?, runId }
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    runId?: string;
    reportType?: string;
  };

  if (!body.name || !body.runId) {
    return NextResponse.json({ error: "name and runId are required." }, { status: 400 });
  }

  try {
    // Fetch the source run to extract configuration
    const runs = await fetchRestRows<{
      id: string;
      status: string;
      brief: Record<string, string>;
      template_profile_id: string | null;
      target_slide_count: number | null;
      author_model: string | null;
      requested_by: string;
    }>({
      supabaseUrl,
      serviceKey,
      table: "deck_runs",
      query: {
        select: "id,status,brief,template_profile_id,target_slide_count,author_model,requested_by",
        id: `eq.${body.runId}`,
        limit: "1",
      },
    });

    const run = runs[0];
    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    if (run.requested_by !== viewer.user.id) {
      return NextResponse.json({ error: "You can only save recipes from your own runs." }, { status: 403 });
    }

    if (run.status !== "completed") {
      return NextResponse.json({ error: "Recipes can only be saved from completed runs." }, { status: 400 });
    }

    // Prefer the requested count saved on the run; fall back to the delivered manifest for older runs.
    let slideCount = run.target_slide_count ?? 10;
    try {
      const manifests = await fetchRestRows<{ slide_count: number }>({
        supabaseUrl,
        serviceKey,
        table: "artifact_manifests_v2",
        query: {
          select: "slide_count",
          run_id: `eq.${body.runId}`,
          limit: "1",
        },
      });
      if (!run.target_slide_count && manifests[0]?.slide_count) {
        slideCount = manifests[0].slide_count;
      }
    } catch { /* manifest table may not exist */ }

    // Insert recipe with full configuration
    const response = await fetch(`${supabaseUrl}/rest/v1/recipes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: viewer.user.id,
        name: body.name,
        description: body.description ?? null,
        report_type: body.reportType ?? "custom",
        brief: run.brief,
        template_profile_id: run.template_profile_id,
        target_slide_count: slideCount,
        author_model: run.author_model ?? "claude-sonnet-4-6",
        source_run_id: body.runId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(text);
    }

    const [recipe] = (await response.json()) as Array<{ id: string; name: string }>;

    return NextResponse.json(recipe, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save recipe.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
