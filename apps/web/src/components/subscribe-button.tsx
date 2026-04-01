"use client";

import { useState } from "react";

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

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subscription", plan, interval }),
      });

      if (response.status === 401) {
        window.location.href = `/sign-in?next=/pricing`;
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
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
