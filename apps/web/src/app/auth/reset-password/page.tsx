import { ResetPasswordUpdateForm } from "@/components/reset-password-update-form";
import { getViewerState, sanitizeNextPath } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
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
  const initialMessage = typeof params.message === "string" ? params.message : undefined;

  return (
    <div className="page-shell public-page auth-page-shell">
      <section className="panel auth-intro-panel stack-lg">
        <p className="section-label">Password reset</p>
        <h1>Choose a new password.</h1>
        <p className="muted">
          Pick a new password and you will be signed in automatically.
        </p>
      </section>

      <ResetPasswordUpdateForm
        configured={viewer.configured}
        nextPath={nextPath}
        initialMessage={initialMessage}
      />
    </div>
  );
}
