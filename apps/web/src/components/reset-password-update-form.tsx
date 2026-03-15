"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { buildSignInPath } from "@/lib/supabase/paths";

type RecoveryState = "checking" | "ready" | "invalid";

export function ResetPasswordUpdateForm({
  configured,
  nextPath,
  initialMessage,
}: {
  configured: boolean;
  nextPath: string;
  initialMessage?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<RecoveryState>("checking");
  const [userEmail, setUserEmail] = useState("");
  const [message, setMessage] = useState(initialMessage ?? "");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const helperCopy = useMemo(() => {
    if (status === "ready") {
      return userEmail
        ? `Set a new password for ${userEmail}.`
        : "Set a new password to reopen your Basquio workspace.";
    }

    if (status === "invalid") {
      return "This recovery link is missing, expired, or already used.";
    }

    return "We’re verifying your recovery session.";
  }, [status, userEmail]);

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
    const recoveryHint =
      window.location.hash.includes("access_token") ||
      window.location.hash.includes("type=recovery") ||
      window.location.search.includes("type=recovery");
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const authErrorDescription = hashParams.get("error_description");

    const fallbackTimer = window.setTimeout(() => {
      if (isMounted) {
        setStatus((current) => (current === "checking" ? "invalid" : current));
        setError((current) =>
          current || "We couldn't verify the recovery link. Request a new reset email and try again.",
        );
      }
    }, recoveryHint ? 5000 : 1500);

    const resolveSession = async () => {
      if (authErrorDescription) {
        if (!isMounted) {
          return;
        }

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
          setError(payload?.error ?? "We couldn't verify the recovery link. Request a new reset email and try again.");
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (session?.user) {
        window.clearTimeout(fallbackTimer);
        setStatus("ready");
        setUserEmail(session.user.email ?? "");
        setError("");
      }
    };

    void resolveSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || session?.user) {
        window.clearTimeout(fallbackTimer);
        setStatus("ready");
        setUserEmail(session?.user?.email ?? "");
        setError("");
      }
    });

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, [configured]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status !== "ready") {
      setError("Open the reset link from your email before setting a new password.");
      return;
    }

    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match yet.");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase auth is not configured yet.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        throw updateError;
      }

      setMessage("Password updated. Redirecting you back into Basquio.");
      router.replace(nextPath);
      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to update password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel auth-card stack-xl">
      <div className="stack">
        <p className="section-label">Password recovery</p>
        <h1>Set a new password</h1>
        <p className="muted">{helperCopy}</p>
      </div>

      <form className="stack-lg" onSubmit={handleSubmit}>
        <div className="form-grid auth-form-grid">
          <label className="field field-span-2">
            <span>New password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label className="field field-span-2">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="confirmPassword"
              placeholder="Repeat the new password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>

        <div className="row auth-actions">
          <button className="button" type="submit" disabled={isSubmitting || status !== "ready"}>
            {isSubmitting ? "Updating..." : "Update password"}
          </button>
          <Link className="button secondary" href={buildSignInPath(nextPath)}>
            Back to sign in
          </Link>
        </div>
      </form>

      {status === "checking" ? <div className="panel auth-status-panel">Verifying your recovery link...</div> : null}
      {message ? <div className="panel success-panel auth-status-panel">{message}</div> : null}
      {error ? <div className="panel danger-panel auth-status-panel">{error}</div> : null}
    </section>
  );
}
