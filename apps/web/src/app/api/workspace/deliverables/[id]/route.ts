import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { handleMemoryCommand } from "@/lib/workspace/memory-tool";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const patchSchema = z.object({
  body_markdown: z.string().min(1).max(200_000),
  record_preference: z.boolean().default(true),
});

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  }

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace(viewer);
  const db = getDb();
  const { data: existing, error: loadError } = await db
    .from("workspace_deliverables")
    .select("id, body_markdown, prompt, scope, kind, metadata")
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  }

  const previousBody = (existing as { body_markdown: string | null }).body_markdown ?? "";

  const { error: updateError } = await db
    .from("workspace_deliverables")
    .update({
      body_markdown: payload.body_markdown,
      metadata: {
        ...(((existing as { metadata: Record<string, unknown> }).metadata) ?? {}),
        edited_by: viewer.user.email ?? viewer.user.id,
        edited_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (payload.record_preference && previousBody && previousBody !== payload.body_markdown) {
    const scope = (existing as { scope: string | null }).scope ?? "workspace";
    const memoryPath = `/preferences/edits-${id.slice(0, 8)}.md`;
    const fullPath = `/memories/${scope}${memoryPath}`;
    const memoryBody = renderMemoryBody({
      prompt: (existing as { prompt: string }).prompt,
      previousBody,
      newBody: payload.body_markdown,
      editedBy: viewer.user.email ?? viewer.user.id,
    });
    try {
      await handleMemoryCommand(
        { command: "create", path: fullPath, file_text: memoryBody },
        { workspaceId: workspace.id, organizationId: workspace.organization_id },
      );
    } catch (error) {
      console.error(`[workspace] failed to record procedural memory for ${id}`, error);
    }
  }

  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}

function renderMemoryBody(input: {
  prompt: string;
  previousBody: string;
  newBody: string;
  editedBy: string;
}): string {
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  return [
    `# Edit preference learned ${new Date().toISOString().slice(0, 10)}`,
    `Edited by: ${input.editedBy}`,
    "",
    "## Original prompt",
    input.prompt,
    "",
    "## Before edit (truncated)",
    truncate(input.previousBody, 1200),
    "",
    "## After edit (truncated)",
    truncate(input.newBody, 1200),
    "",
    "## Apply next time",
    "When responding to similar prompts, prefer the After-edit phrasing, structure, and tone.",
  ].join("\n");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
