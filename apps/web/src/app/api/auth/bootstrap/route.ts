import { NextResponse } from "next/server";

import { bootstrapViewerAccount } from "@/lib/auth-bootstrap";
import type { SignupAttribution } from "@/lib/signup-attribution";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as { signupAttribution?: SignupAttribution | null } | null;
    const result = await bootstrapViewerAccount(viewer.user, {
      signupAttribution: payload?.signupAttribution ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finish account setup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
