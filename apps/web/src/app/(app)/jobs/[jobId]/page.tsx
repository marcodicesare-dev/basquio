import { notFound } from "next/navigation";

import { RunProgressView } from "@/components/run-progress-view";
import { getViewerState } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  if (!UUID_RE.test(jobId)) {
    notFound();
  }

  return <RunProgressView jobId={jobId} initialSnapshot={null} />;
}
