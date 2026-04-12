import assert from "node:assert/strict";

import { notifyRunCompletionIfRequested } from "../packages/workflows/src/notify-completion";

type DeckRunRow = {
  id: string;
  requested_by: string;
  notify_on_complete: boolean;
  completion_email_sent_at: string | null;
  brief: Record<string, unknown> | null;
  created_at: string;
};

type Scenario = {
  name: string;
  runRow: DeckRunRow;
  priorCompletedCount?: number;
  lastFailureAt?: string | null;
  creditBalance?: number | null;
  authEmail?: string | null;
  authFullName?: string | null;
  resendStatus?: number;
  resendBody?: string;
  assert: (result: ScenarioResult) => void | Promise<void>;
};

type ScenarioResult = {
  requests: Array<{ method: string; url: string }>;
  resendPayloads: Array<Record<string, unknown>>;
  runRow: DeckRunRow;
};

const BASE_CONFIG = {
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  resendApiKey: "re_test",
};

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

async function main() {
  const scenarios: Scenario[] = [
    {
      name: "first_run_clean uses claim-first and first-run copy",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: null,
        brief: { businessContext: "Analyze category share shifts across retailers." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      creditBalance: 40,
      authEmail: "lukasz@example.com",
      authFullName: "Lukasz Kowalski",
      assert: ({ requests, resendPayloads, runRow }) => {
        assert.equal(resendPayloads.length, 1);
        assert.equal(runRow.completion_email_sent_at !== null, true);

        const claimIndex = requests.findIndex((request) =>
          request.method === "PATCH" && request.url.includes("completion_email_sent_at=is.null"),
        );
        const resendIndex = requests.findIndex((request) =>
          request.method === "POST" && request.url === "https://api.resend.com/emails",
        );
        assert.notEqual(claimIndex, -1);
        assert.notEqual(resendIndex, -1);
        assert.ok(claimIndex < resendIndex);

        const payload = resendPayloads[0];
        const html = String(payload.html);
        assert.equal(payload.subject, "Your deck is ready: Share shift headline");
        assert.ok(html.includes("FIRST DECK READY"));
        assert.ok(html.includes("Hi Lukasz,"));
        assert.ok(html.includes("Open the narrative alongside the deck."));
        assert.ok(html.includes("Generate another deck"));
        assert.ok(html.includes("utm_campaign=first_run_clean"));
      },
    },
    {
      name: "first_run_after_retry uses retry acknowledgment",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: null,
        brief: { objective: "Pressure test the IGAN market response." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      lastFailureAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      creditBalance: 5,
      authEmail: "dan@example.com",
      authFullName: null,
      assert: ({ resendPayloads }) => {
        assert.equal(resendPayloads.length, 1);
        const html = String(resendPayloads[0].html);
        if (!html.includes("DECK READY")) {
          throw new Error(`Retry variant html was: ${html}`);
        }
        assert.ok(!html.includes("FIRST DECK READY"));
        assert.ok(html.includes("Hi there,"));
        assert.ok(html.includes("The earlier run hit a wall. This one came through."));
        assert.ok(html.includes("See pricing"));
        assert.ok(html.includes("utm_campaign=first_run_after_retry"));
      },
    },
    {
      name: "first_run_after_retry uses older failure copy when retry was not recent",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: null,
        brief: { objective: "Older retry path." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      lastFailureAt: "2026-04-10T09:00:00.000Z",
      creditBalance: 5,
      authEmail: "kshanker@example.com",
      authFullName: "K Shanker",
      assert: ({ resendPayloads }) => {
        assert.equal(resendPayloads.length, 1);
        const html = String(resendPayloads[0].html);
        assert.ok(html.includes("We know the first attempt didn&#39;t land. This one&#39;s good."));
        assert.ok(html.includes("utm_campaign=first_run_after_retry"));
      },
    },
    {
      name: "returning user keeps legacy completion email",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: null,
        brief: { objective: "Measure share of voice by channel." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      priorCompletedCount: 1,
      creditBalance: 80,
      authEmail: "returning@example.com",
      authFullName: "Purushothaman N",
      assert: ({ resendPayloads }) => {
        assert.equal(resendPayloads.length, 1);
        const html = String(resendPayloads[0].html);
        assert.ok(html.includes("DECK READY"));
        assert.ok(!html.includes("FIRST DECK READY"));
        assert.ok(!html.includes("Open the narrative alongside the deck."));
        assert.ok(html.includes("editable PPTX, markdown narrative, and the supporting Excel workbook."));
        assert.ok(html.includes("utm_campaign=returning"));
      },
    },
    {
      name: "already-sent run does not send again",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: "2026-04-12T11:00:00.000Z",
        brief: { objective: "No-op rerun." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      authEmail: "already@example.com",
      assert: ({ requests, resendPayloads }) => {
        assert.equal(resendPayloads.length, 0);
        assert.equal(
          requests.some((request) => request.method === "PATCH" && request.url.includes("completion_email_sent_at=is.null")),
          false,
        );
      },
    },
    {
      name: "failed Resend releases the claim",
      runRow: {
        id: RUN_ID,
        requested_by: USER_ID,
        notify_on_complete: true,
        completion_email_sent_at: null,
        brief: { objective: "Failure path." },
        created_at: "2026-04-12T10:00:00.000Z",
      },
      authEmail: "failure@example.com",
      resendStatus: 500,
      resendBody: "boom",
      assert: ({ requests, resendPayloads, runRow }) => {
        assert.equal(resendPayloads.length, 1);
        assert.equal(runRow.completion_email_sent_at, null);
        assert.equal(
          requests.some((request) =>
            request.method === "PATCH" && request.url.includes(`completion_email_sent_at=eq.`),
          ),
          true,
        );
      },
    },
  ];

  for (const scenario of scenarios) {
    await runScenario(scenario);
    console.log(`PASS ${scenario.name}`);
  }
}

async function runScenario(scenario: Scenario) {
  const requests: Array<{ method: string; url: string }> = [];
  const resendPayloads: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const runRow: DeckRunRow = { ...scenario.runRow };
  const priorCompletedCount = scenario.priorCompletedCount ?? 0;
  const lastFailureAt = scenario.lastFailureAt ?? null;
  const creditBalance = scenario.creditBalance ?? null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ method, url });

    if (url.startsWith("https://api.resend.com/emails")) {
      resendPayloads.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(
        scenario.resendStatus && scenario.resendStatus >= 400 ? { error: scenario.resendBody ?? "error" } : { id: "email_123" },
        scenario.resendStatus ?? 200,
      );
    }

    if (url.startsWith(`${BASE_CONFIG.supabaseUrl}/auth/v1/admin/users/`)) {
      return jsonResponse({
        email: scenario.authEmail ?? null,
        user_metadata: scenario.authFullName ? { full_name: scenario.authFullName } : {},
      });
    }

    if (url.startsWith(`${BASE_CONFIG.supabaseUrl}/rest/v1/deck_runs`)) {
      const parsed = new URL(url);
      if (method === "GET") {
        const select = parsed.searchParams.get("select");
        if (select === "notify_on_complete,completion_email_sent_at,brief,created_at") {
          return jsonResponse([
            {
              notify_on_complete: runRow.notify_on_complete,
              completion_email_sent_at: runRow.completion_email_sent_at,
              brief: runRow.brief,
              created_at: runRow.created_at,
            },
          ]);
        }
        if (select === "id") {
          return jsonResponse(Array.from({ length: priorCompletedCount }, (_, index) => ({ id: `completed-${index}` })));
        }
        if (select === "updated_at") {
          return jsonResponse(lastFailureAt ? [{ updated_at: lastFailureAt }] : []);
        }
      }

      if (method === "PATCH") {
        const currentSentAt = parsed.searchParams.get("completion_email_sent_at");
        if (currentSentAt === "is.null") {
          if (runRow.completion_email_sent_at !== null) {
            return jsonResponse([]);
          }
          const body = JSON.parse(String(init?.body ?? "{}")) as { completion_email_sent_at?: string };
          runRow.completion_email_sent_at = body.completion_email_sent_at ?? null;
          return jsonResponse([
            {
              notify_on_complete: runRow.notify_on_complete,
              completion_email_sent_at: runRow.completion_email_sent_at,
              brief: runRow.brief,
              created_at: runRow.created_at,
            },
          ]);
        }

        if (currentSentAt?.startsWith("eq.")) {
          const expected = currentSentAt.slice(3);
          if (runRow.completion_email_sent_at === expected) {
            runRow.completion_email_sent_at = null;
          }
          return jsonResponse([]);
        }
      }
    }

    if (url.startsWith(`${BASE_CONFIG.supabaseUrl}/rest/v1/credit_balances`)) {
      return jsonResponse(
        typeof creditBalance === "number" ? [{ balance: creditBalance }] : [],
      );
    }

    if (url.startsWith(`${BASE_CONFIG.supabaseUrl}/rest/v1/artifact_manifests_v2`)) {
      return jsonResponse([{ preview_assets: null }]);
    }

    throw new Error(`Unhandled fetch in test harness: ${method} ${url}`);
  }) as typeof fetch;

  try {
    await notifyRunCompletionIfRequested(
      BASE_CONFIG,
      { id: runRow.id, requested_by: runRow.requested_by },
      { runId: runRow.id, slideCount: 12, headline: "Share shift headline" },
    );

    await scenario.assert({
      requests,
      resendPayloads,
      runRow,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
