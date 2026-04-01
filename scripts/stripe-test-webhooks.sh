#!/bin/bash
# Stripe Webhook Testing Script
# Tests all webhook event types against the local webhook handler.
#
# Prerequisites:
#   1. stripe login
#   2. stripe listen --forward-to localhost:3000/api/stripe/webhook (running in another terminal)
#   3. App running on localhost:3000 (pnpm dev)
#
# Usage:
#   bash scripts/stripe-test-webhooks.sh

set -euo pipefail

echo "=== Stripe Webhook Test Suite ==="
echo ""
echo "Make sure 'stripe listen' and 'pnpm dev' are both running."
echo ""

# ─── TEST 1: Credit Pack Purchase ─────────────────────────────
echo "--- Test 1: checkout.session.completed (credit pack) ---"
stripe trigger checkout.session.completed 2>&1 | tail -3
echo ""

# ─── TEST 2: Subscription Created ─────────────────────────────
echo "--- Test 2: customer.subscription.created ---"
stripe trigger customer.subscription.created 2>&1 | tail -3
echo ""

# ─── TEST 3: Subscription Updated ─────────────────────────────
echo "--- Test 3: customer.subscription.updated ---"
stripe trigger customer.subscription.updated 2>&1 | tail -3
echo ""

# ─── TEST 4: Invoice Paid (subscription renewal) ──────────────
echo "--- Test 4: invoice.paid ---"
stripe trigger invoice.paid 2>&1 | tail -3
echo ""

# ─── TEST 5: Invoice Payment Failed ───────────────────────────
echo "--- Test 5: invoice.payment_failed ---"
stripe trigger invoice.payment_failed 2>&1 | tail -3
echo ""

# ─── TEST 6: Subscription Deleted ─────────────────────────────
echo "--- Test 6: customer.subscription.deleted ---"
stripe trigger customer.subscription.deleted 2>&1 | tail -3
echo ""

echo "=== All webhook triggers sent. Check server logs for processing. ==="
echo ""
echo "Expected behavior:"
echo "  1. checkout.session.completed → logs 'granted X credits' (or skips if no metadata)"
echo "  2. subscription.created → logs 'upserted subscription' (or skips if no metadata)"
echo "  3. subscription.updated → logs 'upserted subscription' (or skips if no metadata)"
echo "  4. invoice.paid → logs 'granted subscription credits' (or skips if no subscription)"
echo "  5. invoice.payment_failed → logs 'marked subscription past_due'"
echo "  6. subscription.deleted → logs 'subscription canceled'"
echo ""
echo "Note: stripe trigger sends generic fixtures without our custom metadata."
echo "Handlers should gracefully skip events without user_id/plan metadata."
echo "Full e2e testing requires creating real checkout sessions via the UI."
