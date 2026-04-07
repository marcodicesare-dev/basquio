"use client";

import { useEffect, useRef, useState } from "react";

import { getBrowserSessionUser } from "@/lib/supabase/browser";

async function startSubscriptionCheckout(plan: string, interval: "monthly" | "annual") {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "subscription", plan, interval }),
  });

  if (response.status === 401) {
    return { status: 401 as const };
  }

  const data = await response.json();
  return { status: response.status, data: data as { url?: string; error?: string } };
}

export function SubscribeButton({
  plan,
  label,
  highlighted = false,
  interval = "monthly",
}: {
  plan: string;
  label: string;
  highlighted?: boolean;
  interval?: "monthly" | "annual";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoResumed = useRef(false);
  const signInHref = `/sign-in?next=${encodeURIComponent(`/pricing?subscribe=${plan}&interval=${interval}`)}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const subscribePlan = searchParams.get("subscribe");
    const subscribeInterval = searchParams.get("interval");
    if (autoResumed.current) {
      return;
    }
    if (subscribePlan !== plan || subscribeInterval !== interval) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const user = await getBrowserSessionUser();
      if (!user || cancelled || autoResumed.current) {
        return;
      }

      autoResumed.current = true;
      setLoading(true);
      setError(null);

      try {
        const result = await startSubscriptionCheckout(plan, interval);
        if (cancelled) {
          return;
        }
        if (result.status === 401) {
          setLoading(false);
          window.location.href = signInHref;
          return;
        }
        if (result.status >= 400 || !result.data?.url) {
          setError(result.data?.error ?? "Something went wrong.");
          setLoading(false);
          return;
        }
        window.location.href = result.data.url;
      } catch {
        if (!cancelled) {
          setError("Network error. Please try again.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [interval, plan, signInHref]);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const user = await getBrowserSessionUser();
      if (!user) {
        window.location.href = signInHref;
        return;
      }

      const result = await startSubscriptionCheckout(plan, interval);

      if (result.status === 401) {
        window.location.href = signInHref;
        return;
      }

      if (result.status >= 400) {
        setError(result.data?.error ?? "Something went wrong.");
        return;
      }

      if (result.data?.url) {
        window.location.href = result.data.url;
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={highlighted ? "button" : "button secondary"}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error ? <p className="form-error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}
    </div>
  );
}
