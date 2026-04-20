import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { cloneWorkspace, getWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const bodySchema = z.object({
  template_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80),
  visibility: z.enum(["private", "team", "shareable_with_token"]).default("private"),
});

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace cloning is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const template = await getWorkspace(payload.template_id);
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (template.kind !== "demo_template") {
    return NextResponse.json(
      { error: "Only demo_template workspaces can be cloned." },
      { status: 400 },
    );
  }

  const workspace = await cloneWorkspace({
    templateId: payload.template_id,
    organizationId: viewer.user.id,
    name: payload.name,
    slug: payload.slug,
    visibility: payload.visibility,
    createdBy: viewer.user.id,
  });

  return NextResponse.json({
    workspace_id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    template_id: workspace.template_id,
  });
}
