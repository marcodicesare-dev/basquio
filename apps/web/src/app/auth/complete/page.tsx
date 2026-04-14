import { AuthComplete } from "@/components/auth-complete";
import { bootstrapViewerAccount } from "@/lib/auth-bootstrap";
import { readSignupAttributionFromCookie } from "@/lib/signup-attribution";
import { getViewerState, sanitizeNextPath } from "@/lib/supabase/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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

  if (viewer.user) {
    try {
      const headerStore = await headers();
      await bootstrapViewerAccount(viewer.user, {
        signupAttribution: readSignupAttributionFromCookie(headerStore.get("cookie")),
      });
      redirect(nextPath);
    } catch (error) {
      console.warn(
        `[auth-complete] server bootstrap failed for ${viewer.user.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return (
    <div className="page-shell public-page auth-page-shell">
      <section className="panel auth-intro-panel stack-lg">
        <p className="section-label">Almost there</p>
        <h1>Completing sign-in...</h1>
        <p className="muted">
          This usually takes a moment. Once confirmed, you will be signed in automatically.
        </p>
      </section>

      <AuthComplete configured={viewer.configured} nextPath={nextPath} hasServerSession={Boolean(viewer.user)} />
    </div>
  );
}
