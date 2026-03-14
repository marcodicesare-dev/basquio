import { RunProgressView } from "@/components/run-progress-view";
import { getGenerationStatus } from "@/lib/run-status";

export const dynamic = "force-dynamic";

export default async function JobProgressPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const snapshot = await getGenerationStatus(jobId);

  return <RunProgressView jobId={jobId} initialSnapshot={snapshot} />;
}
