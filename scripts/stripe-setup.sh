#!/bin/bash
# Stripe Product & Price Setup Script
# Run after `stripe login` to create all Basquio billing products in TEST mode.
#
# Usage:
#   stripe login
#   bash scripts/stripe-setup.sh
#
# This creates all products and prices, then outputs env vars to paste into .env.local

set -euo pipefail

echo "=== Creating Basquio Stripe Products (Test Mode) ==="
echo ""

# ─── SUBSCRIPTION PRODUCTS ────────────────────────────────────

echo "Creating Starter plan..."
STARTER_PROD=$(stripe products create \
  --name="Basquio Starter" \
  --description="30 credits/month. No branding. 2 custom template slots." \
  --format=json 2>/dev/null | jq -r '.id')

STARTER_MONTHLY=$(stripe prices create \
  --product="$STARTER_PROD" \
  --unit-amount=1900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

STARTER_ANNUAL=$(stripe prices create \
  --product="$STARTER_PROD" \
  --unit-amount=19000 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $STARTER_PROD"
echo "  Monthly: $STARTER_MONTHLY ($19/mo)"
echo "  Annual:  $STARTER_ANNUAL ($190/yr)"
echo ""

echo "Creating Pro plan..."
PRO_PROD=$(stripe products create \
  --name="Basquio Pro" \
  --description="100 credits/month. Priority queue. 5 custom template slots." \
  --format=json 2>/dev/null | jq -r '.id')

PRO_MONTHLY=$(stripe prices create \
  --product="$PRO_PROD" \
  --unit-amount=14900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

PRO_ANNUAL=$(stripe prices create \
  --product="$PRO_PROD" \
  --unit-amount=149000 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $PRO_PROD"
echo "  Monthly: $PRO_MONTHLY ($149/mo)"
echo "  Annual:  $PRO_ANNUAL ($1,490/yr)"
echo ""

echo "Creating legacy Team compatibility prices..."
TEAM_PROD=$(stripe products create \
  --name="Basquio Team (Legacy)" \
  --description="Legacy compatibility plan for historical team subscriptions." \
  --format=json 2>/dev/null | jq -r '.id')

TEAM_MONTHLY=$(stripe prices create \
  --product="$TEAM_PROD" \
  --unit-amount=14900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

TEAM_ANNUAL=$(stripe prices create \
  --product="$TEAM_PROD" \
  --unit-amount=142800 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $TEAM_PROD"
echo "  Monthly: $TEAM_MONTHLY ($149/mo legacy)"
echo "  Annual:  $TEAM_ANNUAL ($1,428/yr legacy)"
echo ""

# ─── TEAM SEAT ADD-ON ─────────────────────────────────────────

echo "Creating legacy Team Seat add-on..."
SEAT_PROD=$(stripe products create \
  --name="Team Seat (Legacy)" \
  --description="Legacy compatibility seat add-on for historical team subscriptions." \
  --format=json 2>/dev/null | jq -r '.id')

SEAT_MONTHLY=$(stripe prices create \
  --product="$SEAT_PROD" \
  --unit-amount=2900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

SEAT_ANNUAL=$(stripe prices create \
  --product="$SEAT_PROD" \
  --unit-amount=27600 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $SEAT_PROD"
echo "  Monthly: $SEAT_MONTHLY ($29/seat/mo)"
echo "  Annual:  $SEAT_ANNUAL ($276/seat/yr)"
echo ""

# ─── CREDIT PACKS ─────────────────────────────────────────────

echo "Creating tier-specific Credit Pack prices..."
PACK25_PROD=$(stripe products create \
  --name="25 Credits" \
  --description="Credit pack: 25 Basquio credits" \
  --format=json 2>/dev/null | jq -r '.id')

FREE_PACK_25=$(stripe prices create \
  --product="$PACK25_PROD" \
  --unit-amount=2200 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
STARTER_PACK_25=$(stripe prices create \
  --product="$PACK25_PROD" \
  --unit-amount=1750 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
PRO_PACK_25=$(stripe prices create \
  --product="$PACK25_PROD" \
  --unit-amount=1250 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK50_PROD=$(stripe products create \
  --name="50 Credits" \
  --description="Credit pack: 50 Basquio credits" \
  --format=json 2>/dev/null | jq -r '.id')

FREE_PACK_50=$(stripe prices create \
  --product="$PACK50_PROD" \
  --unit-amount=4400 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
STARTER_PACK_50=$(stripe prices create \
  --product="$PACK50_PROD" \
  --unit-amount=3500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
PRO_PACK_50=$(stripe prices create \
  --product="$PACK50_PROD" \
  --unit-amount=2500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK100_PROD=$(stripe products create \
  --name="100 Credits" \
  --description="Credit pack: 100 Basquio credits" \
  --format=json 2>/dev/null | jq -r '.id')

FREE_PACK_100=$(stripe prices create \
  --product="$PACK100_PROD" \
  --unit-amount=8800 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
STARTER_PACK_100=$(stripe prices create \
  --product="$PACK100_PROD" \
  --unit-amount=7000 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
PRO_PACK_100=$(stripe prices create \
  --product="$PACK100_PROD" \
  --unit-amount=5000 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK250_PROD=$(stripe products create \
  --name="250 Credits" \
  --description="Credit pack: 250 Basquio credits" \
  --format=json 2>/dev/null | jq -r '.id')

FREE_PACK_250=$(stripe prices create \
  --product="$PACK250_PROD" \
  --unit-amount=22000 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
STARTER_PACK_250=$(stripe prices create \
  --product="$PACK250_PROD" \
  --unit-amount=17500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')
PRO_PACK_250=$(stripe prices create \
  --product="$PACK250_PROD" \
  --unit-amount=12500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Free pack 25:     $FREE_PACK_25 ($22)"
echo "  Starter pack 25:  $STARTER_PACK_25 ($17.50)"
echo "  Pro pack 25:      $PRO_PACK_25 ($12.50)"
echo "  Free pack 50:     $FREE_PACK_50 ($44)"
echo "  Starter pack 50:  $STARTER_PACK_50 ($35)"
echo "  Pro pack 50:      $PRO_PACK_50 ($25)"
echo "  Free pack 100:    $FREE_PACK_100 ($88)"
echo "  Starter pack 100: $STARTER_PACK_100 ($70)"
echo "  Pro pack 100:     $PRO_PACK_100 ($50)"
echo "  Free pack 250:    $FREE_PACK_250 ($220)"
echo "  Starter pack 250: $STARTER_PACK_250 ($175)"
echo "  Pro pack 250:     $PRO_PACK_250 ($125)"
echo ""

# ─── TEMPLATE FEE + LEGACY TEMPLATE SLOT ─────────────────────

echo "Creating one-time template fee..."
TEMPLATE_FEE_PROD=$(stripe products create \
  --name="Custom Template Run Fee" \
  --description="One-time custom template unlock for free-plan runs" \
  --format=json 2>/dev/null | jq -r '.id')

TEMPLATE_FEE=$(stripe prices create \
  --product="$TEMPLATE_FEE_PROD" \
  --unit-amount=500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Template fee: $TEMPLATE_FEE ($5 one-time)"
echo ""

echo "Creating legacy recurring template slot prices..."
TEMPLATE_LEGACY_PROD=$(stripe products create \
  --name="Custom Template Slot (Legacy)" \
  --description="Legacy recurring custom template slot price for historical subscriptions" \
  --format=json 2>/dev/null | jq -r '.id')

TEMPLATE_MONTHLY=$(stripe prices create \
  --product="$TEMPLATE_LEGACY_PROD" \
  --unit-amount=1000 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

TEMPLATE_ANNUAL=$(stripe prices create \
  --product="$TEMPLATE_LEGACY_PROD" \
  --unit-amount=9600 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Legacy monthly: $TEMPLATE_MONTHLY ($10/mo)"
echo "  Legacy annual:  $TEMPLATE_ANNUAL ($96/yr)"
echo ""

# ─── OUTPUT ENV VARS ──────────────────────────────────────────

echo "=== Add these to .env.local ==="
echo ""
echo "# Stripe Billing (Test Mode)"
echo "STRIPE_SECRET_KEY=\$(stripe config --list 2>/dev/null | grep test_mode_api_key | cut -d= -f2 | tr -d ' ')"
echo "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=\$(stripe config --list 2>/dev/null | grep test_mode_pub_key | cut -d= -f2 | tr -d ' ')"
echo ""
echo "# Subscription prices"
echo "STRIPE_PRICE_STARTER_MONTHLY=$STARTER_MONTHLY"
echo "STRIPE_PRICE_STARTER_ANNUAL=$STARTER_ANNUAL"
echo "STRIPE_PRICE_PRO_MONTHLY=$PRO_MONTHLY"
echo "STRIPE_PRICE_PRO_ANNUAL=$PRO_ANNUAL"
echo ""
echo "# Tier-specific credit pack prices"
echo "STRIPE_PRICE_FREE_PACK_25=$FREE_PACK_25"
echo "STRIPE_PRICE_FREE_PACK_50=$FREE_PACK_50"
echo "STRIPE_PRICE_FREE_PACK_100=$FREE_PACK_100"
echo "STRIPE_PRICE_FREE_PACK_250=$FREE_PACK_250"
echo "STRIPE_PRICE_STARTER_PACK_25=$STARTER_PACK_25"
echo "STRIPE_PRICE_STARTER_PACK_50=$STARTER_PACK_50"
echo "STRIPE_PRICE_STARTER_PACK_100=$STARTER_PACK_100"
echo "STRIPE_PRICE_STARTER_PACK_250=$STARTER_PACK_250"
echo "STRIPE_PRICE_PRO_PACK_25=$PRO_PACK_25"
echo "STRIPE_PRICE_PRO_PACK_50=$PRO_PACK_50"
echo "STRIPE_PRICE_PRO_PACK_100=$PRO_PACK_100"
echo "STRIPE_PRICE_PRO_PACK_250=$PRO_PACK_250"
echo "STRIPE_PRICE_TEAM_MONTHLY=$TEAM_MONTHLY"
echo "STRIPE_PRICE_TEAM_ANNUAL=$TEAM_ANNUAL"
echo "STRIPE_PRICE_TEAM_SEAT_MONTHLY=$SEAT_MONTHLY"
echo "STRIPE_PRICE_TEAM_SEAT_ANNUAL=$SEAT_ANNUAL"
echo ""
echo "# Generic fallback credit pack prices"
echo "STRIPE_PRICE_PACK_25=$FREE_PACK_25"
echo "STRIPE_PRICE_PACK_50=$FREE_PACK_50"
echo "STRIPE_PRICE_PACK_100=$FREE_PACK_100"
echo "STRIPE_PRICE_PACK_250=$FREE_PACK_250"
echo ""
echo "# Template fee + legacy template slot prices"
echo "STRIPE_PRICE_TEMPLATE_FEE=$TEMPLATE_FEE"
echo "STRIPE_PRICE_TEMPLATE_MONTHLY=$TEMPLATE_MONTHLY"
echo "STRIPE_PRICE_TEMPLATE_ANNUAL=$TEMPLATE_ANNUAL"
echo ""
echo "=== Next steps ==="
echo "1. Run: stripe listen --forward-to localhost:3000/api/stripe/webhook"
echo "2. Copy the webhook signing secret (whsec_...) and add to .env.local as STRIPE_WEBHOOK_SECRET"
echo "3. Start the app: pnpm dev"
echo "4. Test: stripe trigger checkout.session.completed"
