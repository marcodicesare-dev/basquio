import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  createMemoryEntry,
  listMemoryEntries,
  type MemoryType,
} from "@/lib/workspace/memory";
import { getScope } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const getQuerySchema = z.object({
  scope_id: z.string().uuid().optional(),
  memory_type: z.enum(["procedural", "semantic", "episodic"]).optional(),
  include_archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1"),
});

const postSchema = z.object({
  workspace_scope_id: z.string().uuid(),
  memory_type: z.enum(["procedural", "semantic", "episodic"]),
  content: z.string().trim().min(1).max(20_000),
  path: z.string().trim().max(240).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  const url = new URL(request.url);
  const rawQuery = {
    scope_id: url.searchParams.get("scope_id") ?? undefined,
    memory_type: url.searchParams.get("memory_type") ?? undefined,
    include_archived: url.searchParams.get("include_archived") ?? undefined,
  };
  let query: z.infer<typeof getQuerySchema>;
  try {
    query = getQuerySchema.parse(rawQuery);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid query." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace();
  const entries = await listMemoryEntries({
    workspaceId: workspace.id,
    scopeId: query.scope_id,
    memoryType: query.memory_type as MemoryType | undefined,
    includeArchived: query.include_archived,
  });
  return NextResponse.json({ workspace_id: workspace.id, entries });
}

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  let payload: z.infer<typeof postSchema>;
  try {
    payload = postSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace();
  const scope = await getScope(payload.workspace_scope_id);
  if (!scope || scope.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Scope not found in this workspace." }, { status: 404 });
  }

  const entry = await createMemoryEntry({
    workspaceId: workspace.id,
    workspaceScopeId: scope.id,
    memoryType: payload.memory_type,
    content: payload.content,
    path: payload.path,
    metadata: {
      ...(payload.metadata ?? {}),
      taught_by: viewer.user.email ?? viewer.user.id,
      taught_at: new Date().toISOString(),
    },
    scope: scope.kind === "system" ? scope.slug : `${scope.kind}:${scope.name}`,
  });

  return NextResponse.json({ entry }, { status: 201 });
}
