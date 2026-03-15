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
      <section className="technical-panel auth-intro-panel stack-lg">
        <p className="section-label light">Password recovery</p>
        <h1>Open the email link, set a new password, and step back into your workspace.</h1>
        <p className="muted">
          Supabase creates a short-lived recovery session from the email link. Once it lands here, Basquio lets you
          set a new password without reopening the public flow.
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
