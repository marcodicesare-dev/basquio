import { AuthComplete } from "@/components/auth-complete";
import { getViewerState, sanitizeNextPath } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AuthCompletePage({
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

  return (
    <div className="page-shell public-page auth-page-shell">
      <section className="technical-panel auth-intro-panel stack-lg">
        <p className="section-label light">Workspace access</p>
        <h1>Finish the email handoff and step into your private Basquio workspace.</h1>
        <p className="muted">
          Some Supabase email links return a short-lived session in the browser URL. Basquio completes that handoff
          here, stores the session, and forwards you into the protected workspace.
        </p>
      </section>

      <AuthComplete configured={viewer.configured} nextPath={nextPath} />
    </div>
  );
}
