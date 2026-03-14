import { after, NextResponse } from "next/server";

import { inngest, runGenerationRequest } from "@basquio/workflows";

import { getGenerationJobState, loadPersistedGenerationRequest } from "@/lib/generation-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeJobs = new Set<string>();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const request = await loadPersistedGenerationRequest(jobId);

  if (!request) {
    return NextResponse.json({ error: "Persisted generation request not found." }, { status: 404 });
  }

  const current = await getGenerationJobState(jobId);
  if (current?.summary || current?.status === "completed") {
    return NextResponse.json({ status: "completed" });
  }

  if (activeJobs.has(jobId)) {
    return NextResponse.json({ status: "running" }, { status: 202 });
  }

  if (process.env.INNGEST_EVENT_KEY) {
    try {
      await inngest.send({
        name: "basquio/generation.requested",
        data: request,
      });

      return NextResponse.json(
        { status: current?.status === "running" ? "resumed" : "requeued" },
        { status: 202 },
      );
    } catch (error) {
      console.error(`Unable to requeue Basquio generation ${jobId} through Inngest`, error);
    }
  }

  activeJobs.add(jobId);

  after(() => {
    void runGenerationRequest(request)
      .catch((error) => {
        console.error(`Basquio generation failed for ${jobId}`, error);
      })
      .finally(() => {
        activeJobs.delete(jobId);
      });
  });

  return NextResponse.json({ status: current?.status === "running" ? "resumed" : "started" }, { status: 202 });
}
