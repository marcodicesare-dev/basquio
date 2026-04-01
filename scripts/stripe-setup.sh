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
  --description="30 credits/month. No branding. 1 custom template slot." \
  --format=json 2>/dev/null | jq -r '.id')

STARTER_MONTHLY=$(stripe prices create \
  --product="$STARTER_PROD" \
  --unit-amount=2900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

STARTER_ANNUAL=$(stripe prices create \
  --product="$STARTER_PROD" \
  --unit-amount=27600 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $STARTER_PROD"
echo "  Monthly: $STARTER_MONTHLY ($29/mo)"
echo "  Annual:  $STARTER_ANNUAL ($276/yr)"
echo ""

echo "Creating Pro plan..."
PRO_PROD=$(stripe products create \
  --name="Basquio Pro" \
  --description="100 credits/month. Priority queue. 5 custom template slots." \
  --format=json 2>/dev/null | jq -r '.id')

PRO_MONTHLY=$(stripe prices create \
  --product="$PRO_PROD" \
  --unit-amount=7900 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

PRO_ANNUAL=$(stripe prices create \
  --product="$PRO_PROD" \
  --unit-amount=75600 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Product: $PRO_PROD"
echo "  Monthly: $PRO_MONTHLY ($79/mo)"
echo "  Annual:  $PRO_ANNUAL ($756/yr)"
echo ""

echo "Creating Team plan..."
TEAM_PROD=$(stripe products create \
  --name="Basquio Team" \
  --description="200 credits/month pool. Shared workspace. 10 custom template slots." \
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
echo "  Monthly: $TEAM_MONTHLY ($149/mo)"
echo "  Annual:  $TEAM_ANNUAL ($1,428/yr)"
echo ""

# ─── TEAM SEAT ADD-ON ─────────────────────────────────────────

echo "Creating Team Seat add-on..."
SEAT_PROD=$(stripe products create \
  --name="Team Seat" \
  --description="Additional team member seat" \
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

echo "Creating Credit Packs..."
PACK25_PROD=$(stripe products create \
  --name="25 Credits" \
  --description="Credit pack: 25 credits for Basquio reports" \
  --format=json 2>/dev/null | jq -r '.id')

PACK25_PRICE=$(stripe prices create \
  --product="$PACK25_PROD" \
  --unit-amount=1800 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK50_PROD=$(stripe products create \
  --name="50 Credits" \
  --description="Credit pack: 50 credits for Basquio reports" \
  --format=json 2>/dev/null | jq -r '.id')

PACK50_PRICE=$(stripe prices create \
  --product="$PACK50_PROD" \
  --unit-amount=3200 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK100_PROD=$(stripe products create \
  --name="100 Credits" \
  --description="Credit pack: 100 credits for Basquio reports" \
  --format=json 2>/dev/null | jq -r '.id')

PACK100_PRICE=$(stripe prices create \
  --product="$PACK100_PROD" \
  --unit-amount=5600 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

PACK250_PROD=$(stripe products create \
  --name="250 Credits" \
  --description="Credit pack: 250 credits for Basquio reports" \
  --format=json 2>/dev/null | jq -r '.id')

PACK250_PRICE=$(stripe prices create \
  --product="$PACK250_PROD" \
  --unit-amount=12500 \
  --currency=usd \
  --format=json 2>/dev/null | jq -r '.id')

echo "  25 credits:  $PACK25_PRICE ($18)"
echo "  50 credits:  $PACK50_PRICE ($32)"
echo "  100 credits: $PACK100_PRICE ($56)"
echo "  250 credits: $PACK250_PRICE ($125)"
echo ""

# ─── TEMPLATE SLOT ─────────────────────────────────────────────

echo "Creating Template Slot..."
TEMPLATE_PROD=$(stripe products create \
  --name="Custom Template Slot" \
  --description="Custom brand template slot for Basquio reports" \
  --format=json 2>/dev/null | jq -r '.id')

TEMPLATE_MONTHLY=$(stripe prices create \
  --product="$TEMPLATE_PROD" \
  --unit-amount=1000 \
  --currency=usd \
  --recurring[interval]=month \
  --format=json 2>/dev/null | jq -r '.id')

TEMPLATE_ANNUAL=$(stripe prices create \
  --product="$TEMPLATE_PROD" \
  --unit-amount=9600 \
  --currency=usd \
  --recurring[interval]=year \
  --format=json 2>/dev/null | jq -r '.id')

echo "  Monthly: $TEMPLATE_MONTHLY ($10/mo)"
echo "  Annual:  $TEMPLATE_ANNUAL ($96/yr)"
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
echo "STRIPE_PRICE_TEAM_MONTHLY=$TEAM_MONTHLY"
echo "STRIPE_PRICE_TEAM_ANNUAL=$TEAM_ANNUAL"
echo "STRIPE_PRICE_TEAM_SEAT_MONTHLY=$SEAT_MONTHLY"
echo "STRIPE_PRICE_TEAM_SEAT_ANNUAL=$SEAT_ANNUAL"
echo ""
echo "# Credit pack prices"
echo "STRIPE_PRICE_PACK_25=$PACK25_PRICE"
echo "STRIPE_PRICE_PACK_50=$PACK50_PRICE"
echo "STRIPE_PRICE_PACK_100=$PACK100_PRICE"
echo "STRIPE_PRICE_PACK_250=$PACK250_PRICE"
echo ""
echo "# Template slot prices"
echo "STRIPE_PRICE_TEMPLATE_MONTHLY=$TEMPLATE_MONTHLY"
echo "STRIPE_PRICE_TEMPLATE_ANNUAL=$TEMPLATE_ANNUAL"
echo ""
echo "=== Next steps ==="
echo "1. Run: stripe listen --forward-to localhost:3000/api/stripe/webhook"
echo "2. Copy the webhook signing secret (whsec_...) and add to .env.local as STRIPE_WEBHOOK_SECRET"
echo "3. Start the app: pnpm dev"
echo "4. Test: stripe trigger checkout.session.completed"
