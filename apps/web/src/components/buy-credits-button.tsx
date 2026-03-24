"use client";

import { useState } from "react";

type BuyCreditsButtonProps = {
  packId: string;
  label: string;
  highlighted: boolean;
};

export function BuyCreditsButton({ packId, label, highlighted }: BuyCreditsButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Checkout failed.");
      }

      window.location.href = payload.url;
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      className={highlighted ? "button" : "button secondary"}
      type="button"
      disabled={loading}
      onClick={handleClick}
    >
      {loading ? "Redirecting..." : label}
    </button>
  );
}
