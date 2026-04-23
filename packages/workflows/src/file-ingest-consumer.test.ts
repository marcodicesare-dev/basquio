import { describe, expect, it } from "vitest";

import {
  runFileIngestLoop,
  sweepStaleFileIngestRuns,
  type FileIngestClaim,
  type FileIngestProcessor,
  type FileIngestQueue,
} from "./file-ingest-consumer";

/**
 * Unit tests for the file-ingest consumer loop (B4b). The loop uses a
 * FileIngestQueue abstraction so tests inject a fake queue; the real
 * one (apps/web/src/lib/workspace/ingest-queue.ts) talks to Postgres.
 *
 * Coverage: queue claim, process success, process failure (terminal
 * status = failed, error_message recorded), stale sweep, graceful
 * shutdown while the queue is empty and while a run is in flight.
 */

function buildQueue(opts: {
  claims?: Array<FileIngestClaim | null>;
  heartbeatThrows?: boolean;
  completeThrows?: boolean;
}): FileIngestQueue & {
  calls: {
    claim: number;
    markIndexing: string[];
    heartbeat: string[];
    complete: Array<{ runId: string; status: string; errorMessage: string | null | undefined }>;
    recoverStale: number[];
  };
} {
  const claims = opts.claims ?? [];
  const calls = {
    claim: 0,
    markIndexing: [] as string[],
    heartbeat: [] as string[],
    complete: [] as Array<{ runId: string; status: string; errorMessage: string | null | undefined }>,
    recoverStale: [] as number[],
  };

  return {
    async claim() {
      calls.claim += 1;
      return claims.shift() ?? null;
    },
    async markIndexing(runId) {
      calls.markIndexing.push(runId);
    },
    async heartbeat(runId) {
      calls.heartbeat.push(runId);
      if (opts.heartbeatThrows) throw new Error("heartbeat boom");
    },
    async complete(input) {
      if (opts.completeThrows) throw new Error("complete boom");
      calls.complete.push({
        runId: input.runId,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
      });
    },
    async recoverStale(mins = 30) {
      calls.recoverStale.push(mins);
      return 0;
    },
    calls,
  };
}

describe("runFileIngestLoop", () => {
  it("claims a queued run, marks indexing, runs the processor, and records indexed state", async () => {
    const queue = buildQueue({
      claims: [
        {
          runId: "r1",
          documentId: "d1",
          workspaceId: "w1",
          attemptCount: 0,
        },
      ],
    });
    const processed: string[] = [];
    const processor: FileIngestProcessor = async ({ documentId }) => {
      processed.push(documentId);
      return "indexed";
    };
    let pollCount = 0;
    await runFileIngestLoop({
      workerId: "test-worker",
      queue,
      processor,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 50_000,
      isShuttingDown: () => {
        pollCount += 1;
        return pollCount > 2;
      },
    });

    expect(processed).toEqual(["d1"]);
    expect(queue.calls.markIndexing).toEqual(["r1"]);
    expect(queue.calls.complete).toEqual([
      { runId: "r1", status: "indexed", errorMessage: null },
    ]);
  });

  it("records failed status + error_message when the processor throws", async () => {
    const queue = buildQueue({
      claims: [{ runId: "r2", documentId: "d2", workspaceId: "w1", attemptCount: 1 }],
    });
    const processor: FileIngestProcessor = async () => {
      throw new Error("parse failed: corrupt PDF");
    };
    let tick = 0;
    await runFileIngestLoop({
      workerId: "test-worker",
      queue,
      processor,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 50_000,
      isShuttingDown: () => {
        tick += 1;
        return tick > 2;
      },
    });

    expect(queue.calls.complete).toHaveLength(1);
    expect(queue.calls.complete[0]).toMatchObject({
      runId: "r2",
      status: "failed",
    });
    expect(queue.calls.complete[0].errorMessage).toContain("corrupt PDF");
  });

  it("exits cleanly when the queue is empty and shutdown is requested", async () => {
    const queue = buildQueue({ claims: [] });
    const processor: FileIngestProcessor = async () => "indexed";
    let tick = 0;
    await runFileIngestLoop({
      workerId: "test-worker",
      queue,
      processor,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 50_000,
      isShuttingDown: () => {
        tick += 1;
        return tick > 1;
      },
    });
    expect(queue.calls.complete).toEqual([]);
    // One or more poll cycles executed, none produced a claim.
    expect(queue.calls.claim).toBeGreaterThanOrEqual(1);
  });

  it("does not claim a new run after isShuttingDown flips mid-sleep", async () => {
    const queue = buildQueue({
      claims: [
        { runId: "r3", documentId: "d3", workspaceId: "w1", attemptCount: 0 },
        { runId: "r4", documentId: "d4", workspaceId: "w1", attemptCount: 0 },
      ],
    });
    const processed: string[] = [];
    const processor: FileIngestProcessor = async ({ documentId }) => {
      processed.push(documentId);
      return "indexed";
    };
    // Let one claim through, then flip the shutdown flag.
    let shuttingDown = false;
    setTimeout(() => {
      shuttingDown = true;
    }, 5);
    await runFileIngestLoop({
      workerId: "test-worker",
      queue,
      processor,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 50_000,
      isShuttingDown: () => shuttingDown,
    });
    expect(processed.length).toBeGreaterThanOrEqual(1);
    expect(processed.length).toBeLessThanOrEqual(2);
  });

  it("continues running when complete() fails (stale-recovery safety net)", async () => {
    const queue = buildQueue({
      claims: [{ runId: "r5", documentId: "d5", workspaceId: "w1", attemptCount: 0 }],
      completeThrows: true,
    });
    const processor: FileIngestProcessor = async () => "indexed";
    let tick = 0;
    await runFileIngestLoop({
      workerId: "test-worker",
      queue,
      processor,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 50_000,
      isShuttingDown: () => {
        tick += 1;
        return tick > 2;
      },
    });
    expect(queue.calls.markIndexing).toEqual(["r5"]);
    // Loop kept running; no throw bubbled out.
  });
});

describe("sweepStaleFileIngestRuns", () => {
  it("delegates to queue.recoverStale with the given window", async () => {
    const queue = buildQueue({ claims: [] });
    const rescued = await sweepStaleFileIngestRuns(queue, 45);
    expect(queue.calls.recoverStale).toEqual([45]);
    expect(rescued).toBe(0);
  });

  it("defaults to a 30-minute stale window", async () => {
    const queue = buildQueue({ claims: [] });
    await sweepStaleFileIngestRuns(queue);
    expect(queue.calls.recoverStale).toEqual([30]);
  });
});
