import { notFound } from "next/navigation";

import { RunProgressView } from "@/components/run-progress-view";
import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function JobProgressPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const viewer = await getViewerState();

  if (!viewer.user) {
    notFound();
  }

  // Check if this run exists in deck_runs (v2)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    notFound();
  }

  const runs = await fetchRestRows<{ id: string }>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id",
      id: `eq.${jobId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    notFound();
  }

  // The RunProgressView component polls /api/jobs/[jobId] for real-time updates.
  // Pass null as initial snapshot so it fetches immediately.
  return <RunProgressView jobId={jobId} initialSnapshot={null} />;
}
