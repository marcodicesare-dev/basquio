"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { buildSignInPath } from "@/lib/supabase/paths";

type CompletionState = "checking" | "done" | "invalid";

export function AuthComplete({
  configured,
  nextPath,
}: {
  configured: boolean;
  nextPath: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CompletionState>("checking");
  const [error, setError] = useState("");

  const helperCopy = useMemo(() => {
    if (status === "done") {
      return "Your session is ready. Redirecting you into Basquio.";
    }

    if (status === "invalid") {
      return "This sign-in or confirmation link is missing, expired, or already used.";
    }

    return "We’re finishing your authentication and opening your workspace.";
  }, [status]);

  useEffect(() => {
    if (!configured) {
      setStatus("invalid");
      setError("Supabase auth is not configured yet.");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setStatus("invalid");
      setError("Supabase auth is not configured yet.");
      return;
    }

    let isMounted = true;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const authErrorDescription = hashParams.get("error_description");
    const hasAuthHash = Boolean(accessToken || refreshToken || hashParams.get("type"));

    const fallbackTimer = window.setTimeout(() => {
      if (!isMounted) {
        return;
      }

      setStatus("invalid");
      setError("We couldn't finish authentication from that link. Try signing in again.");
    }, hasAuthHash ? 5000 : 1500);

    const complete = async () => {
      if (authErrorDescription) {
        window.clearTimeout(fallbackTimer);
        setStatus("invalid");
        setError(authErrorDescription);
        return;
      }

      if (accessToken && refreshToken) {
        const sessionResponse = await fetch("/auth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken,
            refreshToken,
          }),
        });

        if (!isMounted) {
          return;
        }

        if (!sessionResponse.ok) {
          const payload = (await sessionResponse.json().catch(() => null)) as { error?: string } | null;
          window.clearTimeout(fallbackTimer);
          setStatus("invalid");
          setError(payload?.error ?? "We couldn't complete that session handoff.");
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted || !session?.user) {
        return;
      }

      window.clearTimeout(fallbackTimer);
      setStatus("done");
      setError("");
      router.replace(nextPath);
      router.refresh();
    };

    void complete();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted || !session?.user) {
        return;
      }

      window.clearTimeout(fallbackTimer);
      setStatus("done");
      setError("");
      router.replace(nextPath);
      router.refresh();
    });

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, [configured, nextPath, router]);

  return (
    <section className="panel auth-card stack-xl">
      <div className="stack">
        <p className="section-label">Workspace access</p>
        <h1>Finishing authentication</h1>
        <p className="muted">{helperCopy}</p>
      </div>

      {status === "checking" ? <div className="panel auth-status-panel">Verifying your session...</div> : null}
      {error ? <div className="panel danger-panel auth-status-panel">{error}</div> : null}

      {status === "invalid" ? (
        <div className="row auth-actions">
          <a className="button" href={buildSignInPath(nextPath)}>
            Back to sign in
          </a>
        </div>
      ) : null}
    </section>
  );
}
