import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getViewerState, sanitizeNextPath } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewerState();
  const params = await searchParams;
  const nextPath = sanitizeNextPath(
    typeof params.next === "string" ? params.next : undefined,
    "/dashboard",
  );
  const initialMode =
    params.mode === "sign-up" ? "sign-up" : params.mode === "reset" ? "reset" : "sign-in";
  const initialError = typeof params.error === "string" ? params.error : undefined;
  const initialMessage = typeof params.message === "string" ? params.message : undefined;

  if (viewer.user) {
    redirect(nextPath);
  }

  return (
    <div className="page-shell public-page auth-page-shell">
      <section className="panel auth-intro-panel stack-lg">
        <p className="section-label light">Sign in</p>
        <h1>Welcome back.</h1>
        <p className="muted">
          Your data and presentations stay private to your account.
        </p>
      </section>

      <AuthForm
        configured={viewer.configured}
        nextPath={nextPath}
        initialMode={initialMode}
        initialError={initialError}
        initialMessage={initialMessage}
      />
    </div>
  );
}
