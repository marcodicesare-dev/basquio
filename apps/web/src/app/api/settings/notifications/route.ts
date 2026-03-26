import { NextResponse } from "next/server";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Configuration error." }, { status: 500 });
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_preferences?user_id=eq.${viewer.user.id}&select=notify_on_run_complete&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  if (!response.ok) {
    return NextResponse.json({ notifyOnRunComplete: true });
  }

  const rows = await response.json();
  return NextResponse.json({
    notifyOnRunComplete: rows.length > 0 ? rows[0].notify_on_run_complete : true,
  });
}

export async function PATCH(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Configuration error." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const notifyOnRunComplete = typeof body.notifyOnRunComplete === "boolean" ? body.notifyOnRunComplete : true;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_preferences`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: viewer.user.id,
        notify_on_run_complete: notifyOnRunComplete,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json({ error: `Failed to save preference: ${text}` }, { status: 500 });
  }

  return NextResponse.json({ notifyOnRunComplete });
}
