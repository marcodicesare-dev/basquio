import { NextResponse } from "next/server";

import { bootstrapViewerAccount } from "@/lib/auth-bootstrap";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const result = await bootstrapViewerAccount(viewer.user);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finish account setup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
