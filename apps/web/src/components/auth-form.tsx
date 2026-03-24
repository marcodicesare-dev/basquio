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
        ? "Create an account to open your private Basquio workspace."
        : mode === "reset"
          ? "Enter your email and we’ll send a secure reset link to create a new password."
          : "Sign in to start or continue a report.",
    [mode],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      setError("Sign-in is not available yet.");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Sign-in is not available yet.");
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

      {mode !== "reset" ? (
        <div className="stack">
          <button
            className="button secondary auth-google-button"
            type="button"
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              setError("");
              const supabase = getSupabaseBrowserClient();
              if (!supabase) { setError("Sign-in is not available yet."); setIsSubmitting(false); return; }
              const redirectTo = new URL("/auth/callback", window.location.origin);
              redirectTo.searchParams.set("next", nextPath);
              const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: redirectTo.toString() },
              });
              if (oauthError) { setError(oauthError.message); }
              setIsSubmitting(false);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <div className="auth-divider">
            <span>or</span>
          </div>
        </div>
      ) : null}

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
        Basquio keeps the landing site public. Your workspace, uploads, job history, and artifacts stay private to
        your account.
      </p>
    </section>
  );
}
