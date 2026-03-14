import { getGenerationRun, readLocalArtifactBuffer } from "@/lib/job-runs";
import { downloadFromStorage, fetchRestRows } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; kind: string }> },
) {
  const { jobId, kind } = await params;
  const run = await getGenerationRun(jobId);

  if (!run) {
    return new Response("Run not found.", { status: 404 });
  }

  if (kind !== "pptx" && kind !== "pdf") {
    return new Response("Unsupported artifact kind.", { status: 400 });
  }

  const artifact = run.artifacts.find((candidate) => candidate.kind === kind);

  if (!artifact) {
    return new Response("Artifact not found.", { status: 404 });
  }

  try {
    const buffer =
      artifact.provider === "supabase"
        ? await readSupabaseArtifact(artifact.storagePath)
        : artifact.provider === "database"
          ? await readInlineArtifact(jobId, artifact.kind)
          : await readLocalArtifactBuffer(artifact);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read artifact.";
    return new Response(message, { status: 500 });
  }
}

async function readSupabaseArtifact(storagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase storage is configured for this artifact, but service-role credentials are missing.");
  }

  return downloadFromStorage({
    supabaseUrl,
    serviceKey: serviceRoleKey,
    bucket: "artifacts",
    storagePath,
  });
}

async function readInlineArtifact(jobId: string, kind: "pptx" | "pdf") {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase database access is configured for this artifact, but service-role credentials are missing.");
  }

  const jobs = await fetchRestRows<{ id: string }>({
    supabaseUrl,
    serviceKey: serviceRoleKey,
    table: "generation_jobs",
    query: {
      select: "id",
      job_key: `eq.${jobId}`,
      limit: "1",
    },
  });

  if (!jobs[0]?.id) {
    throw new Error(`Run ${jobId} not found in durable state.`);
  }

  const artifacts = await fetchRestRows<{ metadata?: Record<string, unknown> }>({
    supabaseUrl,
    serviceKey: serviceRoleKey,
    table: "artifacts",
    query: {
      select: "metadata",
      job_id: `eq.${jobs[0].id}`,
      kind: `eq.${kind}`,
      limit: "1",
    },
  });

  const inlineBase64 =
    artifacts[0]?.metadata &&
    typeof artifacts[0].metadata === "object" &&
    typeof artifacts[0].metadata.inlineBase64 === "string"
      ? artifacts[0].metadata.inlineBase64
      : null;

  if (!inlineBase64) {
    throw new Error(`Inline artifact payload is missing for ${jobId}/${kind}.`);
  }

  return Buffer.from(inlineBase64, "base64");
}
