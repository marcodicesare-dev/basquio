import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { getScope } from "@/lib/workspace/scopes";
import { buildSuggestions } from "@/lib/workspace/suggestions";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id");
  const scopeId = url.searchParams.get("scope_id");
  const workspace = await getCurrentWorkspace();
  if (workspaceId && workspaceId !== workspace.id) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  const scope = scopeId ? await getScope(scopeId).catch(() => null) : null;
  if (scopeId && (!scope || scope.workspace_id !== workspace.id)) {
    return NextResponse.json({ error: "Scope not found in this workspace." }, { status: 404 });
  }

  const suggestions = await buildSuggestions({
    maxItems: 3,
    scopeId: scope?.id ?? null,
    scopeName: scope?.name ?? null,
  });

  return NextResponse.json({
    suggestions: suggestions.map((suggestion) => ({
      label: suggestion.ctaLabel ?? suggestion.kind,
      prompt: suggestion.prompt,
      reason: suggestion.reason,
    })),
  });
}
