import { downloadFromStorage, fetchRestRows } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type PreviewAssetRow = {
  preview_assets?: Array<{
    position: number;
    fileName: string;
    mimeType: string;
    storageBucket?: string;
    storagePath: string;
  }>;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; position: string }> },
) {
  const { jobId, position } = await params;
  const viewer = await getViewerState();

  if (!viewer.user) {
    return new Response("Authentication required.", { status: 401 });
  }

  const previewPosition = Number.parseInt(position, 10);
  if (!Number.isFinite(previewPosition) || previewPosition <= 0) {
    return new Response("Invalid preview position.", { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  const runs = await fetchRestRows<{ id: string }>({
    supabaseUrl,
    serviceKey: serviceRoleKey,
    table: "deck_runs",
    query: {
      select: "id",
      id: `eq.${jobId}`,
      requested_by: `eq.${viewer.user.id}`,
      limit: "1",
    },
  }).catch(() => []);

  if (!runs[0]?.id) {
    return new Response("Run not found.", { status: 404 });
  }

  const manifests = await fetchRestRows<PreviewAssetRow>({
    supabaseUrl,
    serviceKey: serviceRoleKey,
    table: "artifact_manifests_v2",
    query: {
      select: "preview_assets",
      run_id: `eq.${jobId}`,
      limit: "1",
    },
  }).catch(() => []);

  const preview = Array.isArray(manifests[0]?.preview_assets)
    ? manifests[0].preview_assets.find((asset) => asset.position === previewPosition)
    : null;

  if (!preview?.storagePath) {
    return new Response("Preview not found.", { status: 404 });
  }

  try {
    const buffer = await downloadFromStorage({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      bucket: preview.storageBucket ?? "artifacts",
      storagePath: preview.storagePath,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": preview.mimeType || "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read preview.";
    return new Response(message, { status: /not found|missing/i.test(message) ? 404 : 500 });
  }
}
