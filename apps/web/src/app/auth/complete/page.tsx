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
      <section className="panel auth-intro-panel stack-lg">
        <p className="section-label">Almost there</p>
        <h1>Verifying your email...</h1>
        <p className="muted">
          This usually takes a moment. Once confirmed, you will be signed in automatically.
        </p>
      </section>

      <AuthComplete configured={viewer.configured} nextPath={nextPath} />
    </div>
  );
}
