import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildResetPasswordPath, sanitizeNextPath } from "@/lib/supabase/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = sanitizeNextPath(url.searchParams.get("next"), "/dashboard");
  const redirectOrigin = resolveRedirectOrigin(request, url);
  const signInUrl = new URL("/sign-in", redirectOrigin);
  signInUrl.searchParams.set("next", nextPath);
  const resetPasswordUrl = new URL(buildResetPasswordPath(nextPath), redirectOrigin);

  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    signInUrl.searchParams.set("error", "Supabase auth is not configured yet.");
    return NextResponse.redirect(signInUrl);
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(nextPath, redirectOrigin));
    }

    signInUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(signInUrl);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(resetPasswordUrl);
      }

      return NextResponse.redirect(new URL(nextPath, redirectOrigin));
    }

    signInUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(signInUrl);
  }

  signInUrl.searchParams.set("error", "We couldn't verify that sign-in link.");
  return NextResponse.redirect(signInUrl);
}

function resolveRedirectOrigin(request: Request, url: URL) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }

  return url.origin;
}
