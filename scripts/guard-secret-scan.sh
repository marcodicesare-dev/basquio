#!/usr/bin/env bash
# Fail if any staged diff contains a plausible API secret. Catches the
# common formats we've seen leaked in chat sessions:
#
#   sk-ant-api03-...          Anthropic keys
#   sk_live_...               Stripe / Fiber live secret keys
#   fc-...                    Firecrawl keys (long-form)
#   eyJ...                    JWTs (service-role tokens, auth tokens)
#
# Intentionally broad; callers can rewrite if they have a legitimate
# need to commit one of these patterns (unlikely in this repo).
set -euo pipefail

added=$(git diff --cached --unified=0 | awk '/^\+[^+]/' || true)

# Regex alternation catches each format.
patterns='(sk-ant-api03-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9_-]{20,}|sk_test_[A-Za-z0-9_-]{20,}|fc-[a-f0-9]{32}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'

if printf '%s' "$added" | grep -E -n "$patterns" >/dev/null 2>&1; then
  echo "guard-secret-scan: possible API key in staged diff"
  echo ""
  printf '%s' "$added" | grep -E -n "$patterns" | head -5
  echo ""
  echo "Remove the secret before committing. Rotate the key if it has"
  echo "ever touched a shared surface (chat transcript, pull request)."
  exit 1
fi

exit 0
