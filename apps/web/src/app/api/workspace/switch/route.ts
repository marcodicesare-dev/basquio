import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewerState } from "@/lib/supabase/auth";
import {
  ACTIVE_WORKSPACE_COOKIE,
  listViewerWorkspaces,
} from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspace_id: z.string().uuid(),
});

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
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

  const memberships = await listViewerWorkspaces(viewer);
  const target = memberships.find((w) => w.id === payload.workspace_id);
  if (!target) {
    return NextResponse.json(
      { error: "Workspace not found in your memberships." },
      { status: 404 },
    );
  }

  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return NextResponse.json({
    workspace_id: target.id,
    name: target.name,
    slug: target.slug,
    kind: target.kind,
  });
}
