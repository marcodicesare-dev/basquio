import { notFound } from "next/navigation";

import { RunProgressView } from "@/components/run-progress-view";
import { getViewerState } from "@/lib/supabase/auth";
import { getGenerationStatus } from "@/lib/run-status";

export const dynamic = "force-dynamic";

export default async function JobProgressPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const viewer = await getViewerState();
  const snapshot = await getGenerationStatus(jobId, viewer.user?.id);

  if (!snapshot) {
    notFound();
  }

  return <RunProgressView jobId={jobId} initialSnapshot={snapshot} />;
}
