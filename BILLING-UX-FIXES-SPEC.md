# Billing & Credit UX — Forensic Spec

**Date:** April 16, 2026
**Test account:** `marco.dicesare@felfel.ch` (free plan, Chrome/Mac)
**Evidence:** Vercel request logs, Supabase Storage logs, Supabase Postgres logs, full source audit

---

## Forensic session reconstruction

All times UTC. Filtered to Marco's Chrome/Mac session only (UA `Chrome/147`), excluding iPhone requests (different session/user) and bots.

```
08:34:44  POST /api/generate → 202           Run 1 — standard template, ~10 slides (13 cr)
                                              Balance after: 30 - 13 = 17 credits
08:37:34  GET  /pricing → 304                 Browsing pricing after first run
08:48:46  GET  /billing → 200                 Checking credit balance
08:49:17  GET  /pricing → 200                 Back to pricing — wants to start another run

08:59:19  POST /api/template-fee-drafts → 201    Attempt 2: custom template, ~21 slides (35 cr)
08:59:21  POST /api/stripe/checkout → 200        → Stripe for $5 template fee
~09:00    (user completes Stripe checkout)        → Pays $5
09:00:31  POST /api/stripe/webhook → 200         Stripe webhook: cs_live_a1F... confirmed
09:00:35  POST /api/template-fee-drafts/confirm → 200   Draft → "paid"
09:00:36  POST /api/generate → 402               ← BUG: 35 credits needed, 17 available
09:00:36  redirect → /pricing                     ← BUG: draft cleared, all work destroyed

09:01:44  POST /api/uploads/prepare → 200        Attempt 3: re-upload evidence from scratch
09:01:46  GET  /jobs/f02ac358... → 200           Navigated to job page
09:01:53  POST /api/template-fee-drafts → 201    New draft, ~18 slides (29 cr)
09:01:55  POST /api/stripe/checkout → 200        ← BUG: SECOND $5 charge for same template
09:02:02  /jobs/new?templateFee=cancelled&draft=c9826e3a...   User cancelled (correct instinct)
09:02:09  /jobs/new?templateFee=cancelled&draft=c9826e3a...   Reloaded — still cancelled
09:02:11  GET /billing → 200                      Checking billing — gave up
```

**Net result:**
- Paid $5 template fee → got nothing
- Asked to pay $5 again → correctly refused
- No receipt email for the $5 charge
- Lost all uploaded data, brief, template selection on 402 redirect
- Could not have run anyway: even at 18 slides (29 credits), balance is 17 credits
- User was never told they had insufficient credits until AFTER paying

---

## Credit math for this session

```
Free tier grant:         30 credits
Run 1 (Sonnet, 10 sl):  -13 credits  (3 + 10)
Balance:                  17 credits

Attempt 2 (21 slides):   35 credits needed  → 18 credit shortfall
Attempt 3 (18 slides):   29 credits needed  → 12 credit shortfall
```

The $5 template fee grants ZERO credits — it only unlocks custom-template access for one run. User confusion is guaranteed: paying $5 and then being told you can't afford the run is indistinguishable from being scammed.

---

## Bug 1: Credit check happens AFTER Stripe payment

### Symptom

User pays $5 template fee → auto-resume fires `POST /api/generate` → returns 402 "Not enough credits. This 21-slide deck needs 35 credits."

### Root cause chain

1. `generation-form.tsx:797-833`: When `requiresTemplateFee && selectedTemplateId`, the form creates a template-fee draft and redirects to Stripe **without checking credit balance**
2. After Stripe success, user returns to `/jobs/new?templateFee=success&draft=...`
3. `generation-form.tsx:674-724` (useEffect): Auto-resumes — calls `POST /api/template-fee-drafts/confirm` then `POST /api/generate`
4. `generate/route.ts:272`: `calculateRunCredits(targetSlideCount, authorModel)` computes 35
5. `generate/route.ts:478-487`: RPC `enqueue_deck_run` with `p_charge_credits=true, p_credit_amount=35`
6. `debit_credits_fifo` in SQL: balance is 17 < 35 → returns `insufficient_credits: true`
7. `generate/route.ts:486-487`: Throws `InsufficientCreditsError`
8. `generate/route.ts:188-193`: Returns 402 with `{ code: "NO_CREDITS", pricingUrl: "/pricing" }`

### The problem

Credit validation is ONLY inside `/api/generate` (line 486). No pre-flight check exists anywhere:
- `generation-form.tsx` computes `creditsNeeded` at line 276 but only uses it for DISPLAY in the slide count label (line 1605): `"{creditsNeeded} credits"`
- `POST /api/template-fee-drafts` (route.ts lines 40-155) does NOT check credit balance
- `POST /api/stripe/checkout` (route.ts lines 109-165) does NOT check credit balance
- The form shows no warning when `creditsNeeded > availableBalance`

### Fix

**A. Client-side gate in `generation-form.tsx` before template-fee flow (line ~795)**

Add a credit balance fetch and comparison before entering the template-fee flow:

```typescript
// generation-form.tsx, before line 797:
if (requiresTemplateFee && selectedTemplateId) {
  // Pre-flight: check credits BEFORE sending user to Stripe
  const creditResp = await fetch("/api/credits", { cache: "no-store" });
  if (creditResp.ok) {
    const { balance } = await creditResp.json();
    if (balance < creditsNeeded) {
      setError(
        `This ${isReportOnlyTier ? "report" : `${effectiveTargetSlideCount}-slide deck`} ` +
        `needs ${creditsNeeded} credits but you have ${balance}. ` +
        `Buy more credits before unlocking the custom template.`
      );
      setIsSubmitting(false);
      return;
    }
  }
  // ... existing template-fee flow continues
}
```

**B. Server-side gate in `POST /api/template-fee-drafts` (route.ts, after line 87)**

```typescript
// template-fee-drafts/route.ts, after assertValidSlideCount:
const creditsNeeded = calculateRunCredits(body.targetSlideCount, body.authorModel);
const { balance } = await getDetailedCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
const totalBalance = balance.subscriptionCredits + balance.purchasedCredits + balance.freeCredits + balance.promotionalCredits;
if (totalBalance < creditsNeeded) {
  return NextResponse.json({
    error: `Not enough credits. This run needs ${creditsNeeded} credits, but you have ${totalBalance}.`,
    code: "INSUFFICIENT_CREDITS_FOR_DRAFT",
    creditsNeeded,
    creditsAvailable: totalBalance,
  }, { status: 402 });
}
```

**Both gates needed.** Client-side prevents the Stripe redirect. Server-side prevents programmatic exploitation.

### Files to modify

| File | Line | Change |
|------|------|--------|
| `apps/web/src/components/generation-form.tsx` | ~795 | Add `GET /api/credits` pre-flight before template-fee flow |
| `apps/web/src/app/api/template-fee-drafts/route.ts` | ~87 | Add credit balance validation after slide count validation |
| `apps/web/src/lib/credits.ts` | export | Already exports `calculateRunCredits` — no change needed |

---

## Bug 2: 402 response destroys all user state

### Symptom

After getting 402 from `/api/generate`, user loses uploaded files, brief text, template selection, and slide count. Must restart from scratch.

### Root cause chain

1. `run-progress-view.tsx:302-307`:
```typescript
if (response.status === 402) {
  shouldClearDraft = true;           // line 303
  clearRunLaunchDraft(input.jobId);  // line 304 — DESTROYS localStorage draft
  setHasLaunchDraft(false);          // line 305
  router.replace(payload.pricingUrl ?? "/pricing");  // line 306 — navigates away
  return;                            // line 307
}
```

2. `clearRunLaunchDraft` removes the localStorage entry keyed by `basquio:run-draft:${jobId}`. This entry contains:
   - `runId`, `authorModel`, `templateProfileId`, `targetSlideCount`
   - `brief` (all 6 fields)
   - `sourceFiles` (uploaded file references with storage paths)
   - `existingSourceFileIds`
   - `recipeId`

3. `router.replace("/pricing")` navigates to a static marketing page with no context about what just happened. The pricing page has no mechanism to link back to a prepared run.

4. After buying credits on `/pricing`, success_url goes to `/billing?purchase=success&pack=...` — never back to the run.

### The problem

The 402 handler treats "insufficient credits" the same as a hard 4xx error. But insufficient credits is a **recoverable** condition — the user just needs to buy more. The draft should survive.

### Fix

**Replace the 402 handler in `run-progress-view.tsx:302-307`:**

```typescript
if (response.status === 402) {
  if (payload.code === "NO_CREDITS") {
    // DON'T clear the draft — user needs to buy credits and retry
    setLaunchError(payload.error ?? "Not enough credits for this run.");
    setInsufficientCredits({
      needed: payload.creditsNeeded,
      available: payload.creditsAvailable,
      pricingUrl: payload.pricingUrl ?? "/pricing",
    });
    setIsSubmitting(false);
    saveRunLaunchState(input.jobId, "needs_credits");
    return;
  }
  // Only clear draft for non-recoverable 402s (TEMPLATE_FEE_REQUIRED etc.)
  shouldClearDraft = true;
  clearRunLaunchDraft(input.jobId);
  setHasLaunchDraft(false);
  router.replace(payload.pricingUrl ?? "/pricing");
  return;
}
```

**Add new state and UI in `run-progress-view.tsx`:**

```typescript
const [insufficientCredits, setInsufficientCredits] = useState<{
  needed: number;
  available: number;
  pricingUrl: string;
} | null>(null);
```

**Render an inline "Buy Credits" panel** when `insufficientCredits` is set:

```tsx
{insufficientCredits && (
  <div className="panel warning-panel">
    <h3>Not enough credits</h3>
    <p>
      This run needs {insufficientCredits.needed} credits.
      You have {insufficientCredits.available}.
    </p>
    <div className="stack-sm">
      <BuyCreditsInline
        shortfall={insufficientCredits.needed - insufficientCredits.available}
        returnUrl={`/jobs/${input.jobId}`}
        onPurchaseComplete={() => {
          // Retry generation with the preserved draft
          setInsufficientCredits(null);
          setLaunchError(null);
          launchStartedRef.current = false;
          // useEffect will re-trigger launch
        }}
      />
    </div>
  </div>
)}
```

**Update `/api/generate` 402 response to include credit amounts (line 188-193):**

```typescript
if (error instanceof InsufficientCreditsError) {
  return NextResponse.json({
    error: error.message,
    code: "NO_CREDITS",
    pricingUrl: "/pricing",
    creditsNeeded: error.creditsNeeded,    // ADD
    creditsAvailable: error.creditsAvailable,  // ADD (requires passing balance to error)
  }, { status: 402 });
}
```

**Update `InsufficientCreditsError` to carry balance data:**

```typescript
class InsufficientCreditsError extends Error {
  creditsNeeded: number;
  creditsAvailable: number;
  constructor(needed: number, slideCount: number, available: number) {
    super(`Not enough credits. This ${slideCount}-slide deck needs ${needed} credits.`);
    this.creditsNeeded = needed;
    this.creditsAvailable = available;
  }
}
```

**Credit pack checkout `success_url` must return to the job page, not `/billing`:**

Create a new checkout entry point that knows about the run context:

```typescript
// POST /api/stripe/checkout body:
{
  type: "credit_pack",
  packId: "pack_25",
  returnJobId: "f02ac358-..."  // NEW: tells checkout where to go after purchase
}

// success_url changes to:
success_url: returnJobId
  ? `${origin}/jobs/${returnJobId}?purchase=success&pack=${packId}`
  : `${origin}/billing?purchase=success&pack=${packId}`
```

### Files to modify

| File | Line | Change |
|------|------|--------|
| `apps/web/src/components/run-progress-view.tsx` | 302-307 | Don't clear draft on NO_CREDITS; show inline buy panel |
| `apps/web/src/app/api/generate/route.ts` | 28-34, 188-193 | Add creditsNeeded/creditsAvailable to InsufficientCreditsError and 402 response |
| `apps/web/src/app/api/stripe/checkout/route.ts` | 88-100 | Accept optional `returnJobId`, use it in success_url |
| `apps/web/src/components/buy-credits-inline.tsx` | NEW | Inline credit purchase component for run page |

---

## Bug 3: Template fee charged twice for the same template

### Symptom

User pays $5 for template fee, gets 402, goes back to `/jobs/new`, selects same template, system creates a NEW draft and asks for another $5.

### Root cause chain

1. `generation-form.tsx:797-833`: The `requiresTemplateFee` check (line 275) is `currentPlan === "free" && selectedTemplateId !== null`. This is purely computed from current plan + template selection — it doesn't check for existing paid drafts.

2. `generation-form.tsx:801-821`: Always calls `createTemplateFeeDraft()` which calls `POST /api/template-fee-drafts`. No check for existing paid drafts.

3. `POST /api/template-fee-drafts` (route.ts lines 40-155): Always creates a new draft. The table has NO unique constraint on `(user_id, template_profile_id, status)` that would prevent duplicates.

4. Table schema (`20260403110000`): Only unique constraint is on `stripe_checkout_session_id`. Multiple drafts per user per template are allowed.

5. The first draft (09:00:35 → "paid") is still in the DB but the client doesn't know about it. The form doesn't query for existing paid drafts.

### Fix

**A. Server-side: Reuse existing paid drafts in `POST /api/template-fee-drafts` (route.ts, before draft creation)**

```typescript
// Before creating a new draft, check for existing paid but unconsumed drafts
const existingPaidDrafts = await fetchRestRows<{ id: string; expires_at: string }>({
  supabaseUrl: config.supabaseUrl,
  serviceKey: config.serviceKey,
  table: "template_fee_checkout_drafts",
  query: {
    user_id: `eq.${viewer.user.id}`,
    template_profile_id: `eq.${body.templateProfileId}`,
    status: "eq.paid",
    expires_at: `gt.${new Date().toISOString()}`,
    order: "created_at.desc",
    limit: "1",
  },
});

if (existingPaidDrafts[0]) {
  // Reuse existing paid draft — update its run parameters
  await updateTemplateFeeDraft({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    draftId: existingPaidDrafts[0].id,
    userId: viewer.user.id,
    patch: {
      source_file_ids: resolvedSourceFileIds,
      brief: body.brief,
      target_slide_count: body.targetSlideCount,
      author_model: body.authorModel,
      recipe_id: body.recipeId ?? null,
    },
  });
  return NextResponse.json({ draftId: existingPaidDrafts[0].id, reused: true }, { status: 200 });
}
```

**B. Client-side: Skip Stripe checkout if draft is already paid**

In `generation-form.tsx`, after receiving `draftId` from `createTemplateFeeDraft()`, check `reused` flag:

```typescript
const draftResult = await createTemplateFeeDraft({ ... });
draftId = draftResult.draftId;

if (draftResult.reused) {
  // Draft already paid — skip Stripe, go straight to generation
  const runId = launchRunId ?? reserveRunId();
  launchRun({
    runId,
    authorModel: selectedModel,
    templateProfileId: selectedTemplateId,
    targetSlideCount: effectiveTargetSlideCount,
    brief,
    draftId,
  });
  return;
}

// ... existing Stripe checkout flow for new drafts
```

**C. `launchRun` must pass `draftId` through to `/api/generate`**

Currently `launchRun` (line 527-552) saves to localStorage and navigates. The draft object and the generation call in `run-progress-view.tsx:276-297` must include `draftId`.

Add `draftId` to the localStorage draft shape:

```typescript
// generation-form.tsx launchRun:
saveRunLaunchDraft({
  runId: draft.runId,
  draftId: draft.draftId,  // ADD
  // ... rest of fields
});

// run-progress-view.tsx launch:
body: JSON.stringify({
  jobId: launchDraft.runId,
  draftId: launchDraft.draftId,  // ADD
  // ... rest of fields
}),
```

### Files to modify

| File | Line | Change |
|------|------|--------|
| `apps/web/src/app/api/template-fee-drafts/route.ts` | ~89 | Check for existing paid drafts before creating new one |
| `apps/web/src/components/generation-form.tsx` | ~822 | Handle `reused` flag — skip Stripe if already paid |
| `apps/web/src/components/generation-form.tsx` | 527-552 | Add `draftId` to launchRun draft shape |
| `apps/web/src/components/run-progress-view.tsx` | 276-297 | Pass `draftId` to `/api/generate` |

---

## Bug 4: No Stripe receipt email for ANY payment type

### Symptom

Marco paid $5 template fee AND subscribed to Starter — received NO email receipt for either. Discord screenshot confirms template fee notification fired but no subscription notification.

### Root cause (3 separate issues, all in `checkout/route.ts`)

**Issue A: One-time payments — `receipt_email` silently not sent**

`checkout/route.ts` lines 54, 59, 66 construct `ctx` with `email: viewer.user.email ?? ""`. The `payment_intent_data` spread on lines 92 and 163 is:
```typescript
...(ctx.email ? { payment_intent_data: { receipt_email: ctx.email } } : {}),
```

`viewer.user.email` is `data.user.email ?? null` (from `auth.ts:34`). So the chain is:
- Supabase returns `email: "marco.dicesare@felfel.ch"` (always present for OAuth/magic-link)
- `viewer.user.email ?? ""` → `"marco.dicesare@felfel.ch"` (email IS present)
- `ctx.email ? ...` → truthy → receipt_email IS set

**So for THIS user, the one-time payment receipt_email IS being passed correctly.** The `?? ""` fallback only fails for users with no email in Supabase (edge case, but fix anyway). The real question is: why didn't Marco get the receipt?

**Possible causes for missing template fee receipt:**
1. Stripe Dashboard → Settings → Customer emails → "Successful payments" is DISABLED (most likely)
2. `receipt_email` was set but Stripe delays or suppresses receipts in some cases
3. Email went to spam

**Issue B: Subscription checkout — no receipt mechanism at all**

`handleSubscriptionCheckout` (lines 199-218) uses `mode: "subscription"`. In subscription mode:
- `payment_intent_data` is NOT a valid Stripe parameter — Stripe would reject it
- Subscriptions generate invoices, not payment intents
- Invoice email delivery depends on: (a) Stripe customer having a valid email, and (b) Stripe Dashboard → Settings → Customer emails → "Invoices" being enabled
- The customer object IS created with the email (via `getOrCreateStripeCustomer` at line 197, which calls `stripe.customers.create({ email })` at `stripe.ts:117-120`)
- **But if the Stripe Dashboard setting is off, no email is sent regardless**

**Issue C: Stripe Dashboard settings (MUST CHECK MANUALLY)**

Stripe has TWO global email settings that control receipt/invoice delivery:
1. **Settings → Customer emails → Successful payments** — controls one-time payment receipts
2. **Settings → Customer emails → Invoices** — controls subscription invoice emails

If either is disabled, no emails are sent for that category regardless of code.

### Fix

**1. Code: Change `email: viewer.user.email ?? ""` to `email: viewer.user.email || undefined`**

On lines 54, 59, 66 of `checkout/route.ts`. This ensures:
- `undefined` (not empty string) when email is null → conditional spread produces `{}` (no receipt_email) which is correct behavior for no-email users
- Truthy string when email exists → `receipt_email` is set

Also update `ctx` type from `email: string` to `email: string | undefined` on lines 77, 113, 184.

Also update `getOrCreateStripeCustomer` and `findReusableStripeCustomer` in `stripe.ts` (lines 101, 222) to accept `string | undefined` — both already guard with `if (!email)`.

**2. Code: Ensure Stripe customer email is current before subscription checkout**

Add before the `stripe.checkout.sessions.create` call in `handleSubscriptionCheckout`:
```typescript
if (ctx.email) {
  await stripe.customers.update(customerId, { email: ctx.email }).catch(() => {});
}
```
This ensures the Stripe customer object has the latest email so Stripe knows where to send invoice emails.

**3. Manual: Enable Stripe Dashboard email settings**

- Stripe Dashboard → Settings → Customer emails → Enable "Successful payments"
- Stripe Dashboard → Settings → Customer emails → Enable "Invoices"

### Files to modify

| File | Lines | Change |
|------|-------|--------|
| `apps/web/src/app/api/stripe/checkout/route.ts` | 54, 59, 66 | `email: viewer.user.email ?? ""` → `email: viewer.user.email \|\| undefined` |
| `apps/web/src/app/api/stripe/checkout/route.ts` | 77, 113, 184 | ctx type `email: string` → `email: string \| undefined` |
| `apps/web/src/app/api/stripe/checkout/route.ts` | ~197 | Add `stripe.customers.update(customerId, { email })` before subscription session |
| `apps/web/src/lib/stripe.ts` | 101 | `getOrCreateStripeCustomer` param `email: string` → `string \| undefined` |
| `apps/web/src/lib/stripe.ts` | 222 | `findReusableStripeCustomer` param `email: string` → `string \| undefined` |

---

## Bug 7: Subscription not activated — no plan update, no credits, no Discord notification

### Symptom

Marco subscribed to Starter. Three things should have happened:
1. Plan shows "Starter" on billing page → **shows "Free"**
2. 30 subscription credits granted → **only free tier 30 credits visible (1 remaining)**
3. Discord notification "New subscription" → **never fired**

### Forensic findings (verified via Stripe CLI + Supabase queries, April 16)

**Stripe state (verified):**
- Subscription `sub_1TMmZdDYblaaSu6UvkE0HScR`: status=`active`, plan=Starter Monthly ($19), customer=`cus_ULSh4OFhlG7Dd4`
- Invoice `in_1TMmZaDYblaaSu6UnqAsBCNp`: status=`paid`, amount=$19, metadata has `plan: "starter"` + `user_id`
- Webhook endpoint `we_1TJeQRDYblaaSu6UHsGBR7aY`: status=`enabled`, ALL 7 events are correctly configured

**Stripe events for this subscription:**
| Event | Type | pending_webhooks | Status |
|-------|------|-----------------|--------|
| `evt_...oFAv9wLi` | `checkout.session.completed` | 0 | Delivered |
| `evt_...rXQm1JvU` | `customer.subscription.created` | **1** | **STUCK — never delivered** |
| `evt_...9YHCPqYl` | `invoice.paid` | 0 | Delivered |
| `evt_...eiAdQuhF` | `invoice.payment_succeeded` | 0 | Delivered |

**Supabase state (verified):**
- `subscriptions` table: **EMPTY** for user `c9b5b2fd-...` — no subscription record exists
- `credit_grants` table: Only 1 row — free_tier (30 credits, 1 remaining). NO subscription grant.
- `credit_ledger`: `+30 free_tier` at 06:53, `-29 run_debit` at 09:55. NO `subscription_grant` entry.
- `stripe_webhook_events`: `invoice.paid` event `evt_...9YHCPqYl` marked as `processed: true`

### Root cause — Stripe API version `2026-03-25.dahlia` broke the webhook handler (CRITICAL)

**THE KILL SHOT — `webhook/route.ts` line 449:**

```typescript
// handleInvoicePaid, line 449:
if (!invoice.subscription) return;  // ← invoice.subscription is NULL in new API → RETURNS IMMEDIATELY
```

Stripe API `2026-03-25.dahlia` restructured the invoice object. The webhook endpoint has `api_version: null` (uses account default = `2026-03-25.dahlia`). Key fields moved:

| Field | Old API (what code expects) | New API `2026-03-25.dahlia` (what Stripe sends) |
|-------|---------------------------|-----------------------------------------------|
| `invoice.subscription` | `"sub_xxx"` (string) | **`null`** — moved to `line.parent.subscription_item_details.subscription` |
| `invoice.subscription_details.metadata` | `{ plan: "starter", user_id: "..." }` | **`null`** — metadata is on the line item `line.metadata` |
| `line.price` | `{ recurring: { interval: "month" } }` | **`null`** — moved to `line.pricing.price_details` |
| `line.proration` | `false` (boolean) | **`null`** — moved to `line.parent.subscription_item_details.proration` |

**`handleInvoicePaid` exits at line 449** because `invoice.subscription` is `null`. Credits never granted. No error thrown. Event marked `processed: true` because it returned cleanly.

**Verified from Stripe CLI:**
```
invoice.subscription: None
invoice.subscription_details.metadata: None
invoice.metadata: {}
line[0].price: None
line[0].proration: None
line[0].parent.subscription_item_details.subscription: "sub_1TMmZdDYblaaSu6UvkE0HScR"
line[0].metadata: { plan: "starter", user_id: "c9b5b2fd-..." }
```

**Two failures, same root cause:**

**Failure 1: `invoice.paid` — delivered, silently skipped**
- Webhook arrived → claimed → `handleInvoicePaid` called
- Line 449: `if (!invoice.subscription) return;` → `null` → **returns immediately**
- No credits, no subscription row, no Discord notification
- Event marked `processed: true` (clean return, no exception)

**Failure 2: `customer.subscription.created` — never delivered (pending_webhooks: 1)**
- The subscription object payload IS correct (metadata, items, customer all present)
- But `pending_webhooks: 1` means Stripe never successfully delivered it
- NOT in our `stripe_webhook_events` table — never reached our endpoint
- Possible Stripe delivery failure or retry exhaustion

**Receipt email failure:**
- Both charges have `receipt_email: None` (Stripe CLI verified)
- `billing_details.email: marco.dicesare@felfel.ch` IS set
- Template fee: `payment_intent_data.receipt_email` spread at line 92/163 uses `ctx.email` which is `viewer.user.email ?? ""` — email IS present for this user, so `receipt_email` should have been set. But the charge shows `None`. This means either: (a) the Stripe Checkout Session overrides `receipt_email` to `null`, or (b) Stripe Dashboard "Successful payments" email setting is disabled.
- Subscription: `mode: "subscription"` cannot use `payment_intent_data` — subscription receipts rely entirely on Stripe Dashboard "Invoices" email setting.

### Immediate remediation

**1. Create subscription record (SQL):**
```sql
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval, status, current_period_start, current_period_end, cancel_at_period_end, credits_included, template_slots_included)
VALUES ('c9b5b2fd-540a-436b-834a-59dd29557640', 'cus_ULSh4OFhlG7Dd4', 'sub_1TMmZdDYblaaSu6UvkE0HScR', 'starter', 'monthly', 'active', '2026-04-16T09:50:58Z', '2026-05-16T09:50:58Z', false, 30, 2);
```

**2. Grant 30 subscription credits (SQL):**
```sql
INSERT INTO credit_grants (user_id, source, original_amount, remaining, expires_at, stripe_event_id)
VALUES ('c9b5b2fd-540a-436b-834a-59dd29557640', 'subscription', 30, 30, '2026-06-15T09:50:58Z', 'evt_1TMmZeDYblaaSu6U9YHCPqYl');
```

**3. Write audit trail (SQL):**
```sql
INSERT INTO credit_ledger (user_id, amount, reason, reference_id)
VALUES ('c9b5b2fd-540a-436b-834a-59dd29557640', 30, 'subscription_grant', 'evt_1TMmZeDYblaaSu6U9YHCPqYl');
```

### Code fixes required

**1. Fix `handleInvoicePaid` for new Stripe API shape (CRITICAL — affects ALL future subscription renewals)**

The handler must read the subscription ID from the new location:

```typescript
// webhook/route.ts handleInvoicePaid, replace line 449:

// Old:
if (!invoice.subscription) return;

// New: support both old and new API shapes
const subscriptionId = invoice.subscription
  ?? invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
  ?? null;
if (!subscriptionId) return;
```

Similarly fix metadata resolution (lines 471-472):
```typescript
// Old:
let plan = invoice.subscription_details?.metadata?.plan ?? invoice.metadata?.plan;
let userId = invoice.subscription_details?.metadata?.user_id ?? invoice.metadata?.user_id;

// New: also check line item metadata
const lineMetadata = invoice.lines?.data?.[0]?.metadata ?? {};
let plan = invoice.subscription_details?.metadata?.plan ?? invoice.metadata?.plan ?? lineMetadata.plan;
let userId = invoice.subscription_details?.metadata?.user_id ?? invoice.metadata?.user_id ?? lineMetadata.user_id;
```

And fix the billing interval detection (lines 522-524):
```typescript
// Old:
const isAnnual = lineItem?.price?.recurring?.interval === "year" || billingInterval === "annual";

// New: check both old and new API shape
const recurringInterval = lineItem?.price?.recurring?.interval
  ?? lineItem?.pricing?.price_details?.price_recurring_interval; // may need Stripe expand
const isAnnual = recurringInterval === "year" || billingInterval === "annual";
```

**Alternative: Pin the webhook endpoint to a stable API version:**
```bash
stripe webhook_endpoints update we_1TJeQRDYblaaSu6UHsGBR7aY \
  --api-version "2024-12-18.acacia" \
  --api-key $SK
```
This is the fastest fix — makes Stripe send events in the old format the code expects. But it's a stopgap; eventually the code should handle the current API.

**2. Billing page polling (code fix)**

Detect `?subscription=success` and poll until subscription appears in DB.

**3. Stripe Dashboard: Enable customer emails**

- Settings → Customer emails → "Successful payments" → Enable
- Settings → Customer emails → "Invoices" → Enable

### Files to modify

| File | Change |
|------|--------|
| Supabase SQL Editor | Manual INSERT for subscription, credit_grants, credit_ledger (immediate remediation) |
| `apps/web/src/app/api/stripe/webhook/route.ts` | Fix `handleInvoicePaid` line 449 + metadata + interval for new API shape |
| `apps/web/src/app/api/stripe/webhook/route.ts` | Update invoice type definition (lines 432-445) to include new API fields |
| `apps/web/src/app/(app)/billing/page.tsx` | Add polling after `?subscription=success` |
| Stripe Dashboard | Enable "Successful payments" + "Invoices" email settings (manual) |
| **OR** Stripe CLI | Pin webhook endpoint to stable API version (fastest stopgap) |

---

## Bug 5: No credit cost visibility before submit

### Symptom

The form shows `{creditsNeeded} credits` next to the slide count slider (line 1605), and "$5 one-time unlock" for custom templates (line 1359). But it never shows the user's CURRENT balance or whether they can afford the run.

The user has zero signal that they're about to fail. The information exists — `creditsNeeded` is computed at line 276 — but `availableCredits` is never fetched.

### Fix

**Fetch credit balance on form mount and on model/slide-count change:**

```typescript
// generation-form.tsx — new state:
const [creditBalance, setCreditBalance] = useState<number | null>(null);
const [creditBalanceLoading, setCreditBalanceLoading] = useState(false);

// Fetch on mount + on model change:
useEffect(() => {
  if (currentPlan === "unlimited") return;
  setCreditBalanceLoading(true);
  fetch("/api/credits", { cache: "no-store" })
    .then(r => r.json())
    .then(data => setCreditBalance(data.balance ?? null))
    .catch(() => {})
    .finally(() => setCreditBalanceLoading(false));
}, [currentPlan, selectedModel]);
```

**Show balance + affordability in Review step (near line 1604-1605):**

```tsx
<span className="slide-count-label">
  {targetSlideCount} slides · {creditsNeeded} credits
</span>
{creditBalance !== null && (
  <span className={`credit-balance-label ${creditsNeeded > creditBalance ? "insufficient" : ""}`}>
    {creditsNeeded > creditBalance
      ? `You have ${creditBalance} credits — need ${creditsNeeded - creditBalance} more`
      : `You have ${creditBalance} credits`}
  </span>
)}
```

**Disable submit button when insufficient credits:**

```tsx
// Line ~1656 (submit button):
<button
  type="submit"
  disabled={
    isSubmitting ||
    (creditBalance !== null && creditsNeeded > creditBalance && !requiresTemplateFee)
  }
>
```

Note: Don't disable for `requiresTemplateFee` — let Bug 1's pre-flight check handle that case with a proper error message.

### Files to modify

| File | Line | Change |
|------|------|--------|
| `apps/web/src/components/generation-form.tsx` | ~246 | Add `creditBalance` state |
| `apps/web/src/components/generation-form.tsx` | new useEffect | Fetch `/api/credits` on mount |
| `apps/web/src/components/generation-form.tsx` | ~1604-1605 | Show balance + insufficiency warning |
| `apps/web/src/components/generation-form.tsx` | ~1656 | Disable submit if insufficient |

---

## Bug 6: Template fee UX is confusing and indistinguishable from a scam

### Symptom

User pays $5, immediately gets told they can't run. From the user's perspective, they paid money and got nothing. The $5 bought "custom template access" but the user doesn't know what that means, doesn't know it's separate from credits, and can't see the difference.

### Root cause

The template fee is an access-control gate, not a credit purchase. But the UX doesn't communicate this:

1. The form says "$5 one-time unlock" (line 1359) but doesn't explain what it unlocks vs. what credits cover
2. There's no breakdown showing: "Template unlock: $5 + Run cost: 35 credits (you have 17)"
3. The Stripe checkout description doesn't clarify that credits are separate
4. After paying $5 and getting 402, there's no explanation of what the $5 was for

### Fix

**Replace the template fee label (line 1357-1361) with a full cost breakdown:**

```tsx
{requiresTemplateFee ? (
  <div className="template-fee-breakdown">
    <p className="template-fee-item">
      Custom template unlock: <strong>$5</strong> (one-time)
    </p>
    <p className="template-fee-item">
      Run cost: <strong>{creditsNeeded} credits</strong>
      {creditBalance !== null && (
        creditBalance >= creditsNeeded
          ? <span className="sufficient"> (you have {creditBalance})</span>
          : <span className="insufficient"> (you have {creditBalance} — need {creditsNeeded - creditBalance} more)</span>
      )}
    </p>
  </div>
) : null}
```

### Files to modify

| File | Line | Change |
|------|------|--------|
| `apps/web/src/components/generation-form.tsx` | 1357-1361 | Replace "$5 one-time unlock" with full cost breakdown |

---

## Implementation order

Priority is: unblock subscriptions → fix Marco's account → stop losing money → stop losing work → prevent confusion.

| # | Bug | Effort | Impact |
|---|-----|--------|--------|
| 0a | **Bug 7: Pin webhook API version OR fix handler** | 5 min (pin) or 1 hour (fix code) | **ALL SUBSCRIPTIONS ARE BROKEN.** No one gets credits. Every renewal fails silently. EMERGENCY. |
| 0b | **Bug 7: Manual SQL for felfel.ch account** | 5 min (SQL) | Marco gets his Starter plan + 30 credits. |
| 0c | **Bug 4: Enable Stripe Dashboard emails** | 2 min (manual) | Receipts start sending. |
| 1 | **Bug 4: Receipt email code fixes** | 30 min | `receipt_email` reliably set for all payment types. |
| 2 | **Bug 7: Billing page polling** | 1 hour | Billing page shows "Activating..." instead of stale "Free" after checkout. |
| 3 | **Bug 2: Don't clear draft on 402** | 2-3 hours | Stop destroying user work. |
| 4 | **Bug 1: Pre-flight credit check** | 1-2 hours | Prevent pay-then-fail sequence. |
| 5 | **Bug 3: Reuse paid drafts** | 1-2 hours | Prevent double-charging for same template. |
| 6 | **Bug 5+6: Credit balance + template fee breakdown** | 1-2 hours | User sees cost vs. balance, understands what $5 buys vs. credits. |

**Steps 0a-0c are EMERGENCY and must be done NOW.** Step 0a is the difference between "subscriptions work" and "every subscriber's credits silently vanish."

---

## All files to modify

| File | Bugs | Changes |
|------|------|---------|
| Stripe Dashboard | 4, 7 | Enable webhook events + customer email settings (MANUAL) |
| `apps/web/src/app/api/stripe/checkout/route.ts` | 2, 4 | Fix `email ?? ""` → `email \|\| undefined`. Add `receipt_email`. Accept optional `returnJobId` for success_url. Add `stripe.customers.update` for subscription. |
| `apps/web/src/lib/stripe.ts` | 4 | `getOrCreateStripeCustomer` and `findReusableStripeCustomer` accept `string \| undefined` |
| `apps/web/src/app/api/generate/route.ts` | 2 | Add `creditsNeeded`/`creditsAvailable` to 402 response. Update `InsufficientCreditsError` class. |
| `apps/web/src/app/api/template-fee-drafts/route.ts` | 1, 3 | Add credit pre-flight check. Check for existing paid drafts before creating new one. |
| `apps/web/src/app/(app)/billing/page.tsx` | 7 | Detect `?subscription=success`, poll until subscription appears, show "Activating..." |
| `apps/web/src/components/generation-form.tsx` | 1, 3, 5, 6 | Credit balance fetch. Pre-flight check before template fee. Handle `reused` draft. Cost breakdown. Disable submit when insufficient. |
| `apps/web/src/components/run-progress-view.tsx` | 2, 3 | Don't clear draft on NO_CREDITS. Show inline buy panel. Pass `draftId` to generate. |
| `apps/web/src/components/buy-credits-inline.tsx` | 2 | NEW: Inline credit purchase for run page. |

---

## Database changes

**None required.** The `template_fee_checkout_drafts` table already supports the reuse pattern — just need an application-level query before insert.

Optional: Add a partial unique index to prevent concurrent draft creation races:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_fee_drafts_active_per_user_template
  ON public.template_fee_checkout_drafts (user_id, template_profile_id)
  WHERE status IN ('pending_payment', 'paid');
```

This prevents two `pending_payment` or `paid` drafts for the same user+template from existing simultaneously.

---

## Acceptance criteria

- [ ] Stripe webhook endpoint has all 7 events enabled (manual check)
- [ ] Stripe Dashboard customer email settings enabled for "Successful payments" and "Invoices" (manual check)
- [ ] Subscribing to Starter shows "Starter" on billing page (not "Free") within 10 seconds
- [ ] Subscribing grants 30 subscription credits (visible in balance breakdown)
- [ ] Subscribing triggers Discord "New subscription" notification
- [ ] Every Stripe payment (credit pack, template fee, subscription) sends receipt/invoice to user's email
- [ ] User with 17 credits selecting 21-slide Sonnet deck sees "need 18 more credits" BEFORE hitting Stripe
- [ ] User who gets 402 keeps uploaded files, brief, template selection, and slide count intact
- [ ] User on the job page after 402 sees inline "Buy Credits" with exact shortfall
- [ ] After buying credits inline, run resumes automatically without re-uploading
- [ ] User who already paid $5 template fee is NOT charged again for the same template
- [ ] Reused paid draft updates brief/slides/model without creating a new draft
- [ ] Review step shows: credit balance, credit cost, and whether user can afford the run
- [ ] Template fee section shows cost breakdown: "$5 unlock" + "X credits (you have Y)"
- [ ] Submit button is disabled when credits are insufficient (with clear explanation)
- [ ] Credit pack success_url returns to job page (not /billing) when launched from inline buy panel

---

## Edge cases to test

1. **User buys credits between draft creation and generation launch** — should work; credits are checked at enqueue time
2. **User has exactly enough credits** — should succeed with 0 remaining
3. **Concurrent draft creation** — partial unique index prevents two pending/paid drafts for same template
4. **Expired paid draft** — `generate/route.ts:254-262` already handles this; auto-marks as "expired"
5. **Webhook arrives before client confirm** — `confirm/route.ts:39-41` returns success if already paid (idempotent)
6. **Webhook arrives AFTER client confirm** — `webhook.ts:197-198` returns early if already paid (idempotent)
7. **User cancels Stripe checkout** — form shows "checkout was cancelled" message; draft stays in `pending_payment`
8. **User navigates away during Stripe checkout** — draft expires after 24 hours; user can start over
9. **Annual subscription with 12x monthly credits** — `calculateRunCredits` is plan-agnostic; works correctly
10. **Haiku (Memo) runs** — flat 3 credits; template fee still applies on free plan with custom template
