"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getBrowserSessionUser } from "@/lib/supabase/browser";

type BuyCreditsButtonProps = {
  packId: string;
  label: string;
  highlighted?: boolean;
};

async function startCheckout(packId: string): Promise<{ url?: string; error?: string; status: number }> {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ packId }),
  });

  if (response.status === 401) {
    return { status: 401 };
  }

  const payload = (await response.json()) as { url?: string; error?: string };
  return { ...payload, status: response.status };
}

export function BuyCreditsButton({ packId, label, highlighted }: BuyCreditsButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoResumed = useRef(false);
  const signInHref = `/sign-in?next=${encodeURIComponent(`/pricing?buy=${packId}`)}`;

  // Auto-resume checkout when returning from sign-in with ?buy=pack_id
  useEffect(() => {
    const buyParam = searchParams.get("buy");
    if (buyParam !== packId || autoResumed.current) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const user = await getBrowserSessionUser();
      if (!user || cancelled || autoResumed.current) {
        return;
      }

      autoResumed.current = true;
      const result = await startCheckout(packId);
      if (cancelled) {
        return;
      }
      if (result.status === 401) {
        router.replace(signInHref);
        return;
      }
      if (result.url) {
        window.location.href = result.url;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packId, router, searchParams, signInHref]);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const user = await getBrowserSessionUser();
      if (!user) {
        router.push(signInHref);
        return;
      }

      const result = await startCheckout(packId);

      if (result.status === 401) {
        router.push(signInHref);
        return;
      }

      if (result.status >= 400 || !result.url) {
        throw new Error(result.error ?? "Checkout failed.");
      }

      window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        className={highlighted ? "button" : "button secondary"}
        type="button"
        disabled={loading}
        onClick={handleClick}
      >
        {loading ? "Redirecting to checkout..." : label}
      </button>
      {error ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: 6 }}>{error}</p>
      ) : null}
    </div>
  );
}
