import { getViewerState } from "@/lib/supabase/auth";
import { getCreditBalance, ensureFreeTierCredit } from "@/lib/credits";
import { fetchRestRows } from "@/lib/supabase/admin";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";

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

  let balance = 0;
  let totalRuns = 0;
  let ledger: LedgerEntry[] = [];

  if (supabaseUrl && serviceKey && viewer.user?.id) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const bal = await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    balance = bal.balance;
    totalRuns = bal.totalRuns;
    ledger = await getLedgerHistory(viewer.user.id);
  }

  const totalSpent = ledger
    .filter((e) => e.amount < 0)
    .reduce((sum, e) => sum + Math.abs(e.amount), 0);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Billing & Usage</h1>
      </section>

      <div className="billing-stats-row">
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">{hasUnlimitedUsage ? "Access" : "Credits remaining"}</p>
          <p className="billing-stat-value">{hasUnlimitedUsage ? "Unlimited" : balance}</p>
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Runs started</p>
          <p className="billing-stat-value">{totalRuns}</p>
        </article>
        <article className="panel billing-stat-card">
          <p className="billing-stat-label">Credits spent</p>
          <p className="billing-stat-value">{totalSpent}</p>
        </article>
      </div>

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
