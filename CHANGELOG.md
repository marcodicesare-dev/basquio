# Changelog

Material production events for the Basquio stack. Newest first. Links use git SHAs from `origin/main`.

For full forensic detail on the April 2026 disaster arc and the operational rules it produced, read `memory/april-2026-disaster-arc-forensic.md`.

## 2026-04-27, Stabilization on `aca8be5`

After three consecutive disasters in 7 days the deck pipeline is back at the SHIPPABLE bar.

- `aca8be5` canonical-memory.md addendum confirming pipeline generalization after the diverse smoke
- `a8c26b7` canonical-memory.md Apr 26-27 incident paragraph
- `fab2aa2` squashed revert of the night spiral on `packages/workflows/`. Six "harden"/quality-passport/publish-status commits reverted (`cf79685`, `2e417c4`, `fef8766`, `cb2f205`, `ca0af46`, `7c63d5a`). Four wins kept (`4f1b8ff` brief-data reconciliation gate, `c12f6a1` recovery_reason preservation, `3c6e62b` deck-spec idempotence, `4cc8b88` workbook evidence packets). Two surgical slivers applied. NIQ guard override used once with explicit per-change Marco green-light.

Smoke results:
- Segafredo (`e74b2c15` attempt 23, FMCG coffee, Italian, 11 slides): all 5 SHIPPABLE checks PASS, 28 min, $4.17.
- Watch Retail (`bce46ccb` attempt 2, luxury retail, English, 11 slides): all 5 SHIPPABLE checks PASS, 36 min, $7.48. Reconciliation gate caught a "Bags and Luggage Specialists" outlet type missing from the source dataset and persisted the scope-adjustment note onto slide 4.

Reference baseline: Apr 23 Segafredo deck `ec91f0d0` (status=degraded, user accepted as the working bar). Quality on both Apr 27 smokes ~7/10, in the same band as the 7.4/10 reference.

Memory v1 work is unblocked.

## 2026-04-26, Revert of P0 disaster on `9ea6364`

The April 24 P0 mega-PR (`eb05537`) and 28 hardening-spiral commits reverted. `2f21bc9` deleted 8025 lines. Five subsequent commits restored the four pieces that survived independently (slop-strip UI, contract smoke guard, NIQ knowledge packs, operator rerun budget reset, zero-based manifest position tolerance). Origin/main settled at `9ea6364 Restore deck count publish contract` at 21:32 CET.

`scripts/test-anthropic-skills-contract.ts` was added by `f2ce449` then deleted by `7cd3b2b` "Complete deck generator rollback boundary". The rebuild-strategy doc claimed it was restored; it was not. Stabilization had to recreate an inline contract smoke. Restoring this file is a future P1 hygiene task.

## 2026-04-24, P0 mega-PR disaster (`eb05537`)

Single PR: 24 files, 3,651 insertions, 204 deletions. Bundled `data-primacy-validator.ts` (490 lines), `brief-data-reconciliation.ts`, three other validators, a 622-line edit to `generate-deck.ts`, and a critical change to `anthropic-execution-contract.ts` introducing `webFetchMode: "off" | "enrich"`.

The `"off"` branch returned `[]` from `buildClaudeTools()` for Sonnet/Opus while Skills (`pptx`, `pdf`) remained in the container. Anthropic API rejected with `400 invalid_request_error: container: skills can only be used when a code execution tool is enabled`.

Production deck-worker effectively down at ~16:45 UTC. 28 hours of forward-fix followed before revert. The unit test that asserted the wrong API behavior passed; it was the bug.

## 2026-04-22, Rossella cocktails fabrication (silent quality failure)

Run `1831a13e-12b4-42cf-ba90-c259f062d22c`. Opus 4.7 received a 750-respondent EMEA RTD cocktails consumer-trial-intent survey, read the brief as a market-sizing ask, invented an EMEA RTD cocktail-on-tap dataset to match. The validator passed because Opus's fabricated sheets were the linked sheets. Status shipped as `degraded` on advisory lint, not on the fabrication.

Closed by `4f1b8ff` brief-data reconciliation gate (Apr 26 22:52 CET). Verified to generalize across language and domain on Apr 27.

## 2026-04-20 to 21, Discord bot silent death (24 hours)

Three commits (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the **root** `railway.toml`. The Railway project `basquio-bot` had two services sharing this config. The Discord bot service redeployed with the deck-worker start command, crash-looped on `NEXT_PUBLIC_SUPABASE_URL` undefined, stopped recording at Apr 20 21:14 UTC. The 2-hour Apr 21 strategy session was never captured: no audio, no transcript, no recovery.

Closed by `0b85ff5` (forensic memory entry) and `6a7138e` (dispatcher at Railway entrypoint, service-scoped configs at `apps/bot/railway.toml`).

## Earlier history

For pre-April 2026 events including the March 27-28 forensic, see `memory/march28-48h-forensic-learnings.md`.
