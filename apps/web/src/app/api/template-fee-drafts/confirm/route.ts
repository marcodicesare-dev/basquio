import { NextResponse } from "next/server";

import { getStripe } from "@/lib/stripe";
import { getViewerState } from "@/lib/supabase/auth";
import { getTemplateFeeDraft, updateTemplateFeeDraft } from "@/lib/template-fee-drafts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const body = (await request.json()) as { draftId?: string; sessionId?: string };
  if (!body.draftId || !body.sessionId) {
    return NextResponse.json({ error: "draftId and sessionId are required." }, { status: 400 });
  }

  const draft = await getTemplateFeeDraft({
    supabaseUrl,
    serviceKey,
    draftId: body.draftId,
    userId: viewer.user.id,
  });

  if (!draft) {
    return NextResponse.json({ error: "Template-fee draft not found." }, { status: 404 });
  }

  if (draft.status === "consumed" || draft.status === "paid") {
    return NextResponse.json({ ok: true, draftStatus: draft.status });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(body.sessionId);

  if (session.payment_status !== "paid") {
    return NextResponse.json({ error: "Template fee payment is not complete yet." }, { status: 409 });
  }

  if (session.metadata?.type !== "template_fee" || session.metadata?.draft_id !== body.draftId || session.metadata?.user_id !== viewer.user.id) {
    return NextResponse.json({ error: "Stripe session does not match this template-fee draft." }, { status: 400 });
  }

  await updateTemplateFeeDraft({
    supabaseUrl,
    serviceKey,
    draftId: body.draftId,
    userId: viewer.user.id,
    patch: {
      status: "paid",
      stripe_checkout_session_id: session.id,
      paid_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, draftStatus: "paid" });
}
