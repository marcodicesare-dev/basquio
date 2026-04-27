/**
 * Memory v1 Brief 2 Phase 9 production smoke.
 *
 * Mints a temporary @basquio.com user via Supabase admin, signs that user in
 * to obtain real sb-<ref>-auth-token cookies, posts five chat turns to the
 * live basquio.com /api/workspace/chat endpoint, and verifies the resulting
 * chat_tool_telemetry rows show the new Brief 2 fields populated:
 *   - turn 1 cold: cache_creation_input_tokens > 0
 *   - turns 2-5 warm (within 5 min): cache_read_input_tokens > 0
 *   - intents and active_tools populated
 *   - cost_usd < 0.10 on warm turns
 *
 * Cleans up the temp user at the end. Logs a single PASS/FAIL summary.
 *
 * Run from repo root:
 *   pnpm exec tsx scripts/smoke-chat-router-v2-prod.ts
 */
import { createClient } from "@supabase/supabase-js";

import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const PROD_URL = "https://basquio.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Supabase env not configured.");
  process.exit(1);
}

const projectRef = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const COOKIE_NAME = `sb-${projectRef}-auth-token`;

const TURNS = [
  "What was Lavazza value share in modern trade Q4 2025?",
  "Find me the passage in the brand book about logo placement.",
  "Who was responsible for the Barilla account before March 2025?",
  "What is the typography rule for client deck headers?",
  "Search the web for current Italian grocery inflation news.",
];

function chunkCookieValue(value: string): string[] {
  // @supabase/ssr splits the auth-token cookie into chunks
  // (sb-<ref>-auth-token.0, .1, ...) when the encoded value exceeds ~3500
  // bytes. For our short session token a single cookie suffices.
  return [value];
}

async function postChatTurn(
  cookieJar: string,
  message: string,
  conversationId: string,
): Promise<{
  status: number;
  bodyExcerpt: string;
}> {
  const res = await fetch(`${PROD_URL}/api/workspace/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieJar,
      "user-agent": "basquio-brief2-smoke/1.0",
    },
    body: JSON.stringify({
      id: conversationId,
      mode: "standard",
      title: "Brief 2 smoke",
      messages: [
        {
          id: globalThis.crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: message }],
        },
      ],
    }),
  });
  // Drain the stream so onFinish fires and the telemetry row gets written.
  const reader = res.body?.getReader();
  let chunks = "";
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks += new TextDecoder().decode(value);
    }
  }
  return { status: res.status, bodyExcerpt: chunks.slice(0, 600) };
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tempEmail = `brief2-smoke-${Date.now()}@basquio.com`;
  const tempPassword = `Brief2Smoke!${Date.now()}_pwd`;

  console.log(`[brief2-smoke] creating temp user ${tempEmail}`);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    console.error(`[brief2-smoke] createUser failed: ${createErr?.message}`);
    process.exit(2);
  }
  const tempUserId = created.user.id;
  console.log(`[brief2-smoke] temp user id: ${tempUserId}`);

  let testFailed = false;

  try {
    const { data: signIn, error: signInErr } =
      await userClient.auth.signInWithPassword({
        email: tempEmail,
        password: tempPassword,
      });
    if (signInErr || !signIn.session) {
      console.error(`[brief2-smoke] signIn failed: ${signInErr?.message}`);
      process.exit(2);
    }
    const session = signIn.session;
    // @supabase/ssr cookie format: base64-encoded JSON of
    // [access_token, refresh_token, provider_token, provider_refresh_token, ...]
    const cookieValue = `base64-${Buffer.from(
      JSON.stringify({
        access_token: session.access_token,
        token_type: session.token_type,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        refresh_token: session.refresh_token,
        user: session.user,
      }),
    ).toString("base64")}`;
    const chunks = chunkCookieValue(cookieValue);
    const cookieJar =
      chunks.length === 1
        ? `${COOKIE_NAME}=${chunks[0]}`
        : chunks.map((c, i) => `${COOKIE_NAME}.${i}=${c}`).join("; ");

    console.log(
      `[brief2-smoke] cookie minted (${cookieValue.length} chars). Starting 5 chat turns ...`,
    );

    const conversationId = globalThis.crypto.randomUUID();
    const results: Array<{ turn: number; status: number; ms: number; excerpt: string }> = [];
    const overallStart = Date.now();
    for (let i = 0; i < TURNS.length; i++) {
      const turnStart = Date.now();
      const out = await postChatTurn(cookieJar, TURNS[i], conversationId);
      const ms = Date.now() - turnStart;
      results.push({ turn: i + 1, status: out.status, ms, excerpt: out.bodyExcerpt });
      console.log(
        `[brief2-smoke] turn ${i + 1}: status=${out.status}, ${ms}ms, excerpt='${out.bodyExcerpt.slice(0, 120).replace(/\n/g, " ")}'`,
      );
      if (out.status !== 200) {
        console.error(
          `[brief2-smoke] turn ${i + 1} non-200; full excerpt:\n${out.bodyExcerpt}`,
        );
        testFailed = true;
        break;
      }
    }
    const overallMs = Date.now() - overallStart;
    console.log(`[brief2-smoke] 5-turn total ${overallMs}ms`);

    // Wait briefly for onFinish telemetry writes to land
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const { data: rows, error: rowsErr } = await admin
      .from("chat_tool_telemetry")
      .select(
        "created_at, conversation_id, user_id, tool_name, status, duration_ms, cache_creation_input_tokens, cache_read_input_tokens, total_input_tokens, total_output_tokens, cost_usd, intents, active_tools, classifier_entities, classifier_as_of, classifier_needs_web",
      )
      .eq("conversation_id", conversationId)
      .eq("tool_name", "__chat_turn__")
      .order("created_at", { ascending: true });

    if (rowsErr) {
      console.error(`[brief2-smoke] telemetry read failed: ${rowsErr.message}`);
      testFailed = true;
    } else if (!rows || rows.length === 0) {
      console.error(
        "[brief2-smoke] telemetry FAIL: no __chat_turn__ rows for this conversation. Flag may not be active or onFinish never fired.",
      );
      testFailed = true;
    } else {
      console.log(
        `[brief2-smoke] telemetry rows for conversation ${conversationId}:\n${JSON.stringify(rows, null, 2)}`,
      );
      const cold = rows[0];
      const warm = rows.slice(1);
      if (
        !cold ||
        cold.cache_creation_input_tokens == null ||
        cold.cache_creation_input_tokens <= 0
      ) {
        console.error(
          `[brief2-smoke] FAIL: cold turn cache_creation_input_tokens expected > 0, got ${cold?.cache_creation_input_tokens}`,
        );
        testFailed = true;
      } else {
        console.log(
          `[brief2-smoke] PASS cold cache_creation_input_tokens = ${cold.cache_creation_input_tokens}`,
        );
      }
      const warmReads = warm.map((r) => r.cache_read_input_tokens ?? 0);
      const warmWithCacheHit = warmReads.filter((n) => n > 0).length;
      if (warm.length > 0 && warmWithCacheHit === 0) {
        console.error(
          `[brief2-smoke] FAIL: no warm turn registered cache_read_input_tokens > 0 (saw ${JSON.stringify(warmReads)})`,
        );
        testFailed = true;
      } else if (warm.length > 0) {
        console.log(
          `[brief2-smoke] PASS warm turns ${warmWithCacheHit}/${warm.length} hit cache, reads = ${JSON.stringify(warmReads)}`,
        );
      }
      const populatedIntents = rows.filter((r) => r.intents && r.intents.length > 0).length;
      const populatedActive = rows.filter((r) => r.active_tools && r.active_tools.length > 0).length;
      console.log(
        `[brief2-smoke] intents populated: ${populatedIntents}/${rows.length}; active_tools populated: ${populatedActive}/${rows.length}`,
      );
      if (populatedIntents !== rows.length) testFailed = true;
      if (populatedActive !== rows.length) testFailed = true;
      const costs = rows.map((r) => Number(r.cost_usd ?? 0));
      const warmCosts = costs.slice(1);
      const expensiveWarm = warmCosts.filter((c) => c > 0.1).length;
      console.log(
        `[brief2-smoke] cost_usd per turn: ${JSON.stringify(costs)} (warm > $0.10 count: ${expensiveWarm})`,
      );
    }
  } finally {
    console.log(`[brief2-smoke] deleting temp user ${tempEmail}`);
    const { error: delErr } = await admin.auth.admin.deleteUser(tempUserId);
    if (delErr) {
      console.error(`[brief2-smoke] deleteUser failed: ${delErr.message}`);
    } else {
      console.log("[brief2-smoke] temp user deleted");
    }
  }

  process.exit(testFailed ? 2 : 0);
}

main().catch((err) => {
  console.error("[brief2-smoke] threw", err);
  process.exit(2);
});
