"use client";

import { useState } from "react";

export function BillingActions({
  currentPlan,
  hasSubscription,
}: {
  currentPlan: string;
  hasSubscription: boolean;
}) {
  return (
    <div className="billing-plan-actions">
      {hasSubscription ? (
        <ManageSubscriptionButton />
      ) : currentPlan === "free" ? (
        <a className="button" href="/pricing">
          Upgrade to a plan
        </a>
      ) : null}
    </div>
  );
}

function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Could not open billing portal. Please try again.");
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
        className="button secondary"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? "Opening…" : "Manage subscription"}
      </button>
      {error ? <p className="form-error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}
    </div>
  );
}
