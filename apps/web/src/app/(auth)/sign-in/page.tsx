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
        <div className="stack">
          <p className="section-label">Basquio</p>
          <h1>Your next report is 5 minutes away.</h1>
          <p className="muted">
            Upload your data, describe the brief, and get back a branded PPTX + PDF with every number traced to source.
          </p>
        </div>
        <div className="auth-value-props stack">
          <div className="auth-value-prop">
            <strong>Under 5 minutes</strong>
            <span className="muted">From upload to finished deck</span>
          </div>
          <div className="auth-value-prop">
            <strong>Traceable evidence</strong>
            <span className="muted">Every claim linked to your source data</span>
          </div>
          <div className="auth-value-prop">
            <strong>Two formats, one analysis</strong>
            <span className="muted">Editable PPTX + polished PDF</span>
          </div>
        </div>
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
