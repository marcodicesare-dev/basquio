#!/usr/bin/env bash
# Fail if any staged change modifies the NIQ hardening surface (22406d5).
#
# Hard-deny list (these files must not be modified):
#   packages/workflows/src/metric-presentation.ts
#   packages/intelligence/src/claim-chart-alignment-validator.ts
#   packages/intelligence/src/slide-plan-linter.ts
#   packages/intelligence/src/eval-harness.ts
#   packages/intelligence/src/fidelity-validators.ts
#   NIQ eval test files (eval-harness.test.ts, metric-presentation.test.ts,
#   slide-plan-linter.test.ts, cost-guard.test.ts). Assertion changes
#   would silently weaken 22406d5 regression coverage.
#
# Soft-deny list, allowed to change only via dynamic-block pattern
# (new function params, append-only XML blocks, per-run context):
#   packages/workflows/src/system-prompt.ts. The 11 promo/decimal
#   bullets and the two knowledge pack entries at positions 2 and 3
#   must not be modified. We detect this by checking that the two
#   load lines for niq-promo-storytelling-playbook.md and niq-decimal-
#   policy.md remain in KNOWLEDGE_PACK_FILES. If either disappears
#   from the file, the commit is rejected.
#
# Override: set BASQUIO_NIQ_GUARD_OVERRIDE=1 to bypass when Marco has
# explicitly green-lit a change to the NIQ surface. The override echoes
# a visible warning.

set -euo pipefail

if [[ "${BASQUIO_NIQ_GUARD_OVERRIDE:-}" == "1" ]]; then
  echo "guard-niq-hardening: BASQUIO_NIQ_GUARD_OVERRIDE=1 set, skipping"
  exit 0
fi

HARD_DENY=(
  "packages/workflows/src/metric-presentation.ts"
  "packages/intelligence/src/claim-chart-alignment-validator.ts"
  "packages/intelligence/src/slide-plan-linter.ts"
  "packages/intelligence/src/eval-harness.ts"
  "packages/intelligence/src/fidelity-validators.ts"
  "packages/intelligence/src/eval-harness.test.ts"
  "packages/intelligence/src/metric-presentation.test.ts"
  "packages/intelligence/src/slide-plan-linter.test.ts"
  "packages/workflows/src/cost-guard.test.ts"
)

staged_files=$(git diff --cached --name-only)
violated=()

for path in "${HARD_DENY[@]}"; do
  if echo "$staged_files" | grep -qxF "$path"; then
    violated+=("$path")
  fi
done

if [[ ${#violated[@]} -gt 0 ]]; then
  echo "guard-niq-hardening: 22406d5 NIQ hardening files modified:"
  for path in "${violated[@]}"; do
    echo "  - $path"
  done
  echo ""
  echo "These files carry the NIQ quality gates. If Marco has explicitly"
  echo "green-lit the change, set BASQUIO_NIQ_GUARD_OVERRIDE=1 and retry."
  exit 1
fi

# Soft-deny: system-prompt.ts can evolve but KNOWLEDGE_PACK_FILES must
# keep the two NIQ entries at the documented positions (2 and 3,
# one-indexed). A reordering that pushes them to positions 10+ would
# reduce their cache-priority and silently weaken NIQ enforcement, so
# the guard enforces both presence AND relative position within the
# array. Check the file content on the current tree (not the diff)
# since the staged edit might still leave them intact.
if echo "$staged_files" | grep -qxF "packages/workflows/src/system-prompt.ts"; then
  # Extract lines between `KNOWLEDGE_PACK_FILES = [` and the closing `]`,
  # one entry per line, then check positions.
  positions=$(awk '
    /const KNOWLEDGE_PACK_FILES *= *\[/ {in_array=1; next}
    in_array && /^\] *as const;/ {exit}
    in_array {print NR": "$0}
  ' packages/workflows/src/system-prompt.ts)

  promo_pos=$(echo "$positions" | grep -n "niq-promo-storytelling-playbook.md" | head -1 | cut -d: -f1)
  decimal_pos=$(echo "$positions" | grep -n "niq-decimal-policy.md" | head -1 | cut -d: -f1)

  if [[ -z "$promo_pos" ]]; then
    echo "guard-niq-hardening: niq-promo-storytelling-playbook.md missing from KNOWLEDGE_PACK_FILES"
    exit 1
  fi
  if [[ -z "$decimal_pos" ]]; then
    echo "guard-niq-hardening: niq-decimal-policy.md missing from KNOWLEDGE_PACK_FILES"
    exit 1
  fi
  # Must be at positions 2 and 3 (one-indexed) within the array.
  if [[ "$promo_pos" != "2" ]]; then
    echo "guard-niq-hardening: niq-promo-storytelling-playbook.md moved to position $promo_pos (expected 2)"
    exit 1
  fi
  if [[ "$decimal_pos" != "3" ]]; then
    echo "guard-niq-hardening: niq-decimal-policy.md moved to position $decimal_pos (expected 3)"
    exit 1
  fi
fi

exit 0
