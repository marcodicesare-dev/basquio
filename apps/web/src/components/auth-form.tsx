"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";
type ExtendedAuthMode = AuthMode | "reset";

export function AuthForm({
  configured,
  nextPath,
  initialMode,
  initialError,
  initialMessage,
}: {
  configured: boolean;
  nextPath: string;
  initialMode: ExtendedAuthMode;
  initialError?: string;
  initialMessage?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ExtendedAuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState(initialMessage ?? "");

  const helperCopy = useMemo(
    () =>
      mode === "sign-up"
        ? "Create an account to open your private Basquio workspace. Google can come later."
        : mode === "reset"
          ? "Enter your email and we’ll send a secure reset link to create a new password."
          : "Sign in to continue where your evidence package workflow left off.",
    [mode],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      setError("Supabase auth is not configured yet. Add the project URL and anon key to enable sign-in.");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase auth is not configured yet. Add the project URL and anon key to enable sign-in.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      if (mode === "reset") {
        const resetRedirectTo = new URL("/auth/reset-password", window.location.origin);
        resetRedirectTo.searchParams.set("next", nextPath);

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: resetRedirectTo.toString(),
        });

        if (resetError) {
          throw resetError;
        }

        setMessage("Reset link sent. Check your email and open the link to set a new password.");
        return;
      }

      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        router.replace(nextPath);
        router.refresh();
        return;
      }

      const emailRedirectTo = new URL("/auth/callback", window.location.origin);
      emailRedirectTo.searchParams.set("next", nextPath);

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: emailRedirectTo.toString(),
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (data.session) {
        router.replace(nextPath);
        router.refresh();
        return;
      }

      setMessage("Check your email to confirm your account, then we’ll drop you straight into the workspace.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel auth-card stack-xl">
      <div className="stack">
        <p className="section-label">Workspace access</p>
        <h1>
          {mode === "sign-up"
            ? "Create your Basquio account"
            : mode === "reset"
              ? "Reset your password"
              : "Sign in to continue"}
        </h1>
        <p className="muted">{helperCopy}</p>
      </div>

      <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
        <button
          className={mode === "sign-up" ? "auth-toggle-button active" : "auth-toggle-button"}
          type="button"
          onClick={() => {
            setMode("sign-up");
            setError("");
            setMessage("");
          }}
        >
          Sign up
        </button>
        <button
          className={mode === "sign-in" ? "auth-toggle-button active" : "auth-toggle-button"}
          type="button"
          onClick={() => {
            setMode("sign-in");
            setError("");
            setMessage("");
          }}
        >
          Sign in
        </button>
      </div>

      <form className="stack-lg" onSubmit={handleSubmit}>
        <div className="form-grid auth-form-grid">
          <label className="field field-span-2">
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="you@company.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {mode !== "reset" ? (
            <label className="field field-span-2">
              <span>Password</span>
              <input
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                minLength={8}
                name="password"
                placeholder="At least 8 characters"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        <div className="row auth-actions">
          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Working..." : mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
          </button>
          <Link className="button secondary" href="/">
            Back to landing page
          </Link>
        </div>
      </form>

      <div className="row auth-utility-row">
        {mode === "sign-in" ? (
          <button
            className="auth-text-link"
            type="button"
            onClick={() => {
              setMode("reset");
              setPassword("");
              setError("");
              setMessage("");
            }}
          >
            Forgot password?
          </button>
        ) : null}

        {mode === "reset" ? (
          <button
            className="auth-text-link"
            type="button"
            onClick={() => {
              setMode("sign-in");
              setError("");
              setMessage("");
            }}
          >
            Back to sign in
          </button>
        ) : null}
      </div>

      {message ? <div className="panel success-panel auth-status-panel">{message}</div> : null}
      {error ? <div className="panel danger-panel auth-status-panel">{error}</div> : null}

      <p className="fine-print">
        Basquio keeps the landing site public. The report workspace, uploads, job history, and artifacts stay behind
        your authenticated session.
      </p>
    </section>
  );
}
