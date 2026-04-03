import Link from "next/link";

import { CreditPackShelf } from "@/components/credit-pack-shelf";
import { getViewerState } from "@/lib/supabase/auth";
import { getDetailedCreditBalance, ensureFreeTierCredit, getActiveSubscription } from "@/lib/credits";
import { fetchRestRows } from "@/lib/supabase/admin";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { normalizePlanId, PLAN_CONFIG, type PlanId } from "@/lib/billing-config";
import { BillingActions } from "@/components/billing-actions";

export const dynamic = "force-dynamic";

type LedgerEntry = {
  id: string;
  amount: number;
  reason: string;
  reference_id: string | null;
  created_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "free_tier": return "Free credits";
    case "purchase_pack": return "Credit pack purchase";
    case "subscription_grant": return "Monthly subscription credits";
    case "run_debit": return "Report generation";
    case "refund": return "Refund (failed run)";
    default: return reason;
  }
}

async function getLedgerHistory(userId: string): Promise<LedgerEntry[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  try {
    return await fetchRestRows<LedgerEntry>({
      supabaseUrl,
      serviceKey,
      table: "credit_ledger",
      query: {
        select: "id,amount,reason,reference_id,created_at",
        user_id: `eq.${userId}`,
        order: "created_at.desc",
        limit: "30",
      },
    });
  } catch {
    return [];
  }
}

export default async function BillingPage() {
  const viewer = await getViewerState();
  const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user?.email);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let balance = { balance: 0, freeGrantsCount: 0, totalRuns: 0, subscriptionCredits: 0, purchasedCredits: 0, promotionalCredits: 0, freeCredits: 0 };
  let subscription: Awaited<ReturnType<typeof getActiveSubscription>> = null;
  let ledger: LedgerEntry[] = [];

  if (supabaseUrl && serviceKey && viewer.user?.id) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    balance = await getDetailedCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    subscription = await getActiveSubscription({ supabaseUrl, serviceKey, userId: viewer.user.id });
    ledger = await getLedgerHistory(viewer.user.id);
  }

  const totalSpent = ledger
    .filter((e) => e.amount < 0)
    .reduce((sum, e) => sum + Math.abs(e.amount), 0);

  const currentPlan = normalizePlanId(subscription?.plan ?? "free") as PlanId;
  const planConfig = PLAN_CONFIG[currentPlan];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Billing & Usage</h1>
      </section>

      {/* Plan Card */}
      <section className="panel billing-plan-card">
        <div className="billing-plan-info">
          <div>
            <p className="billing-stat-label">Current plan</p>
            <p className="billing-stat-value">{planConfig.label}</p>
            {subscription ? (
              <p className="muted">
                {subscription.billing_interval === "annual" ? "Annual" : "Monthly"} billing
                {subscription.cancel_at_period_end ? " — cancels at period end" : ""}
              </p>
            ) : null}
          </div>
          {subscription ? (
            <div>
              <p className="billing-stat-label">Next billing date</p>
              <p className="muted">{formatDate(subscription.current_period_end)}</p>
            </div>
          ) : null}
        </div>
        <BillingActions
          currentPlan={currentPlan}
          hasSubscription={!!subscription}
        />
      </section>

      {/* Credit Balance */}
      <div className="billing-stats-row">
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">{hasUnlimitedUsage ? "Access" : "Credits available"}</p>
          <p className="billing-stat-value">{hasUnlimitedUsage ? "Unlimited" : balance.balance}</p>
          {!hasUnlimitedUsage && balance.balance > 0 ? (
            <div className="billing-credit-breakdown">
              {balance.subscriptionCredits > 0 ? (
                <p className="muted">Subscription: {balance.subscriptionCredits}</p>
              ) : null}
              {balance.purchasedCredits > 0 ? (
                <p className="muted">Purchased: {balance.purchasedCredits}</p>
              ) : null}
              {balance.freeCredits > 0 ? (
                <p className="muted">Free: {balance.freeCredits}</p>
              ) : null}
            </div>
          ) : null}
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Runs started</p>
          <p className="billing-stat-value">{balance.totalRuns}</p>
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Credits spent</p>
          <p className="billing-stat-value">{totalSpent}</p>
        </article>
      </div>

      {/* Quick Actions */}
      {!hasUnlimitedUsage ? (
        <div className="billing-actions-row">
          <Link className="button secondary" href="/pricing">
            {currentPlan === "free" ? "Upgrade plan" : "Change plan"}
          </Link>
        </div>
      ) : null}

      {!hasUnlimitedUsage ? (
        <CreditPackShelf
          tone="app"
          plan={currentPlan}
          title="Buy credits inside billing"
          subtitle="The checkout starts from this account, so purchased credits are attached to the signed-in user automatically."
        />
      ) : null}

      {/* Credit History */}
      <section className="stack-lg">
        <h2>Credit history</h2>

        {ledger.length === 0 ? (
          <div className="panel workspace-empty-card workspace-empty-card-compact">
            <p className="muted">No credit activity yet.</p>
          </div>
        ) : (
          <div className="panel billing-ledger">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Activity</th>
                  <th className="billing-table-number-head">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">{formatDate(entry.created_at)}</td>
                    <td>{reasonLabel(entry.reason)}</td>
                    <td className={entry.amount > 0 ? "billing-table-number billing-table-number-positive" : "billing-table-number"}>
                      {entry.amount > 0 ? "+" : ""}{entry.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
