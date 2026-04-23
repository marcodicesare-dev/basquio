#!/usr/bin/env bash
# Fail if any staged diff contains an em dash (U+2014). Per working-
# rules.md §4: em dashes are an AI tell. Removing them is trivial.
#
# Runs in Lefthook pre-commit over staged files. Exits 0 on clean,
# 1 on any hit.
set -euo pipefail

EM_DASH=$'\xe2\x80\x94'

# Check only ADDED lines in the staged diff (ignore removals).
offenders=$(git diff --cached --unified=0 | awk '/^\+[^+]/' || true)

if printf '%s' "$offenders" | grep -F "$EM_DASH" >/dev/null 2>&1; then
  echo "guard-em-dash: em dash (U+2014) present in staged diff"
  echo ""
  printf '%s' "$offenders" | grep -nF "$EM_DASH" | head -10
  echo ""
  echo "Use a period, parenthetical, colon, or comma. See docs/working-rules.md §4."
  exit 1
fi

exit 0
