import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase auth is not configured yet." }, { status: 500 });
  }

  const { accessToken, refreshToken } = (await request.json()) as {
    accessToken?: string;
    refreshToken?: string;
  };

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: "Missing auth session tokens." }, { status: 400 });
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
