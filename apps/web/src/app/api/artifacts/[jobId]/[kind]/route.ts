import { getGenerationRun, readLocalArtifactBuffer } from "@/lib/job-runs";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";

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
      artifact.provider === "supabase" ? await readSupabaseArtifact(artifact.storagePath) : await readLocalArtifactBuffer(artifact);

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

  const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.storage.from("artifacts").download(storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? `Unable to download ${storagePath} from Supabase Storage.`);
  }

  return Buffer.from(await data.arrayBuffer());
}
