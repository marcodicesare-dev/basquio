import { after, NextResponse } from "next/server";

import { inngest } from "@basquio/workflows";

import {
  dispatchPersistedGenerationExecution,
  getInternalDispatchToken,
  getGenerationJobState,
  loadPersistedGenerationRequest,
} from "@/lib/generation-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const scheduledFallbacks = new Set<string>();
const INNGEST_RECOVERY_GRACE_MS = 15_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const dispatchToken = getInternalDispatchToken();

  if (!dispatchToken || request.headers.get("x-basquio-internal-token") !== dispatchToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { jobId } = await params;
  const persistedRequest = await loadPersistedGenerationRequest(jobId);

  if (!persistedRequest) {
    return NextResponse.json({ error: "Persisted generation request not found." }, { status: 404 });
  }

  const current = await getGenerationJobState(jobId);
  if (current?.summary || current?.status === "completed") {
    return NextResponse.json({ status: "completed" });
  }

  let responseStatus = current?.status === "running" ? "resumed" : "started";
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      await inngest.send({
        name: "basquio/generation.requested",
        data: persistedRequest,
      });

      responseStatus = current?.status === "running" ? "resumed" : "requeued";
    } catch (error) {
      console.error(`Unable to requeue Basquio generation ${jobId} through Inngest`, error);
    }
  }

  after(() => {
    if (scheduledFallbacks.has(jobId)) {
      return;
    }

    scheduledFallbacks.add(jobId);

    void scheduleExecuteFallback(jobId, request)
      .catch((error) => {
        console.error(`Basquio execute fallback failed for ${jobId}`, error);
      })
      .finally(() => {
        scheduledFallbacks.delete(jobId);
      });
  });

  return NextResponse.json({ status: responseStatus }, { status: 202 });
}

async function scheduleExecuteFallback(jobId: string, request: Request) {
  if (process.env.INNGEST_EVENT_KEY) {
    await wait(INNGEST_RECOVERY_GRACE_MS);
  }

  await dispatchPersistedGenerationExecution(jobId, request);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
