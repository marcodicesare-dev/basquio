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
          <h1>Upload your data. Get your first deck.</h1>
          <p className="muted">
            Describe what you need, upload your spreadsheet, and get back an editable PowerPoint, a written report, and a data workbook.
          </p>
        </div>
        <div className="auth-value-props stack">
          <div className="auth-value-prop">
            <strong>Track your deck</strong>
            <span className="muted">Follow each phase from upload to finished deck</span>
          </div>
          <div className="auth-value-prop">
            <strong>Numbers from your data</strong>
            <span className="muted">Every chart and claim built from your actual files</span>
          </div>
          <div className="auth-value-prop">
            <strong>Three files, one analysis</strong>
            <span className="muted">Editable PowerPoint + written report + data workbook</span>
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
