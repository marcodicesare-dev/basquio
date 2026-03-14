import process from "node:process";

type InngestServeStatus = {
  mode?: string;
  function_count?: number;
  has_event_key?: boolean;
  has_signing_key?: boolean;
  schema_version?: string;
  extra?: Record<string, unknown>;
};

async function main() {
  const target = process.argv[2] ?? process.env.INNGEST_CHECK_URL ?? "http://localhost:3000/api/inngest";
  const response = await fetch(target, {
    headers: {
      "user-agent": "basquio-inngest-check",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Inngest serve endpoint returned ${response.status} ${response.statusText} for ${target}`);
  }

  const payload = (await response.json()) as InngestServeStatus;

  if ((payload.function_count ?? 0) < 1) {
    throw new Error(`No Inngest functions are registered at ${target}`);
  }

  console.log(`Inngest endpoint: ${target}`);
  console.log(`Mode: ${payload.mode ?? "unknown"}`);
  console.log(`Functions: ${payload.function_count ?? 0}`);
  console.log(`Signing key present: ${payload.has_signing_key ? "yes" : "no"}`);
  console.log(`Event key present: ${payload.has_event_key ? "yes" : "no"}`);
  console.log(`Schema version: ${payload.schema_version ?? "unknown"}`);

  if (!payload.has_signing_key || !payload.has_event_key) {
    throw new Error(
      `Inngest is reachable but not fully connected. Missing keys: ${[
        !payload.has_signing_key ? "INNGEST_SIGNING_KEY" : null,
        !payload.has_event_key ? "INNGEST_EVENT_KEY" : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Basquio Inngest check failed: ${message}`);
  process.exit(1);
});
