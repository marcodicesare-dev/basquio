import { fetchRestRows, insertRestRow } from "./supabase";

type SupabaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

export type RefundCreditResult =
  | { status: "refunded"; amount: number }
  | { status: "already_refunded"; amount: number }
  | { status: "no_debit_found"; amount: 0 };

export async function refundCredit(
  config: SupabaseConfig & { userId: string; runId: string },
): Promise<RefundCreditResult> {
  const debits = await fetchRestRows<{ amount: number }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "credit_ledger",
    query: {
      reference_id: `eq.${config.runId}`,
      reason: "eq.run_debit",
      select: "amount",
      order: "created_at.desc",
      limit: "1",
    },
  });

  const refundAmount = debits.length > 0 ? Math.abs(debits[0].amount) : 0;
  if (refundAmount === 0) {
    return { status: "no_debit_found", amount: 0 };
  }

  try {
    await insertRestRow({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "credit_grants",
      row: {
        user_id: config.userId,
        source: "promotional",
        original_amount: refundAmount,
        remaining: refundAmount,
        expires_at: "2099-12-31T00:00:00Z",
        stripe_event_id: `refund_${config.runId}`,
      },
    });

    await insertRestRow({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "credit_ledger",
      row: {
        user_id: config.userId,
        amount: refundAmount,
        reason: "refund",
        reference_id: config.runId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return { status: "already_refunded", amount: refundAmount };
    }
    throw error;
  }

  return { status: "refunded", amount: refundAmount };
}
