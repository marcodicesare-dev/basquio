import assert from "node:assert/strict";

import {
  buildRequestUsageTerminalPayload,
  type RequestUsageTerminalStatus,
} from "../packages/workflows/src/request-usage-lifecycle";

function assertTerminalStatus(status: RequestUsageTerminalStatus, note?: string) {
  const completedAt = "2026-04-23T07:30:00.000Z";
  const payload = buildRequestUsageTerminalPayload(status, completedAt, note);
  assert.equal(payload.completed_at, completedAt);
  assert.equal(payload.usage.status, status);
  assert.equal(payload.usage.totalTokens, 0);
  if (note) {
    assert.equal(payload.usage.note, note);
  } else {
    assert.ok(!("note" in payload.usage));
  }
}

function main() {
  assertTerminalStatus("failed", "Author phase crashed.");
  assertTerminalStatus("interrupted_shutdown", "Worker shutdown interrupted the request.");
  assertTerminalStatus("stale_timeout", "Attempt was automatically recovered after stale timeout.");
  assertTerminalStatus("superseded");
  process.stdout.write("request usage lifecycle regressions passed\n");
}

main();
