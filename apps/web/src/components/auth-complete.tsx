"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearSignupAttributionFromBrowser,
  readSignupAttributionFromBrowser,
} from "@/lib/signup-attribution";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { buildSignInPath } from "@/lib/supabase/paths";

type CompletionState = "checking" | "done" | "invalid";

async function bootstrapAccountRequest() {
  const signupAttribution = readSignupAttributionFromBrowser();
  const response = await fetch("/api/auth/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(signupAttribution ? { signupAttribution } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "We couldn't finish setting up your workspace.");
  }

  clearSignupAttributionFromBrowser();
}

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
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);

  const helperCopy = useMemo(() => {
    if (status === "done") {
      return "Your sign-in is confirmed. Redirecting you into Basquio.";
    }

    if (status === "invalid") {
      return "This sign-in or confirmation link is missing, expired, or already used.";
    }

    return "We’re checking your link and opening your workspace.";
  }, [status]);

  useEffect(() => {
    if (!configured) {
      setStatus("invalid");
      setError("Sign-in is not available yet.");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setStatus("invalid");
      setError("Sign-in is not available yet.");
      return;
    }

    let isMounted = true;
    const ensureBootstrapOnce = () => {
      if (!bootstrapPromiseRef.current) {
        bootstrapPromiseRef.current = bootstrapAccountRequest();
      }

      return bootstrapPromiseRef.current;
    };
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
          setError(payload?.error ?? "We couldn't finish that sign-in link.");
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted || !session?.user) {
        return;
      }

      try {
        await ensureBootstrapOnce();

        window.clearTimeout(fallbackTimer);
        setStatus("done");
        setError("");
        router.replace(nextPath);
        router.refresh();
      } catch (bootstrapError) {
        window.clearTimeout(fallbackTimer);
        setStatus("invalid");
        setError(bootstrapError instanceof Error ? bootstrapError.message : "We couldn't finish setting up your workspace.");
      }
    };

    void complete();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted || !session?.user) {
        return;
      }

      void ensureBootstrapOnce().then(() => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(fallbackTimer);
        setStatus("done");
        setError("");
        router.replace(nextPath);
        router.refresh();
      }).catch((bootstrapError) => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(fallbackTimer);
        setStatus("invalid");
        setError(bootstrapError instanceof Error ? bootstrapError.message : "We couldn't finish setting up your workspace.");
      });
      return;
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
        <h1>Checking your link</h1>
        <p className="muted">{helperCopy}</p>
      </div>

      {status === "checking" ? <div className="panel auth-status-panel">Verifying your sign-in link...</div> : null}
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
