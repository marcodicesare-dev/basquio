"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type BuyCreditsButtonProps = {
  packId: string;
  label: string;
  highlighted: boolean;
};

export function BuyCreditsButton({ packId, label, highlighted }: BuyCreditsButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });

      if (response.status === 401) {
        // Not signed in — redirect to sign-in with return URL
        router.push(`/sign-in?redirect=${encodeURIComponent(`/pricing?buy=${packId}`)}`);
        return;
      }

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Checkout failed.");
      }

      window.location.href = payload.url;
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
        {loading ? "Redirecting..." : label}
      </button>
      {error ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: 6 }}>{error}</p>
      ) : null}
    </div>
  );
}
