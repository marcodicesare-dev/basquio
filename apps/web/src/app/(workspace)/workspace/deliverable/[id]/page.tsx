import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkspaceDeliverable } from "@/lib/workspace/db";
import { WorkspaceDeliverableView } from "@/components/workspace-deliverable-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deliverable = await getWorkspaceDeliverable(id);
  return {
    title: deliverable ? `${deliverable.title} · Basquio` : "Deliverable · Basquio",
  };
}

export default async function WorkspaceDeliverablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const deliverable = await getWorkspaceDeliverable(id);
  if (!deliverable) notFound();

  const citations = Array.isArray(deliverable.citations)
    ? (deliverable.citations as Array<{
        label: string;
        source_type: string;
        source_id: string;
        filename: string | null;
        excerpt: string;
      }>)
    : [];

  return (
    <div className="wbeta-deliverable-page">
      <header className="wbeta-deliverable-page-head">
        <Link href="/workspace" className="wbeta-deliverable-back">
          ← Back to workspace
        </Link>
        <p className="wbeta-deliverable-page-kicker">
          {deliverable.kind} · scope {deliverable.scope ?? "workspace"} · {citations.length} citations
        </p>
        <h1 className="wbeta-deliverable-page-title">{deliverable.title}</h1>
        <p className="wbeta-deliverable-page-prompt">From: {deliverable.prompt}</p>
        {deliverable.status === "failed" ? (
          <p className="wbeta-deliverable-page-error">
            Generation failed. {deliverable.error_message ?? "Try again from the workspace home."}
          </p>
        ) : null}
      </header>

      <WorkspaceDeliverableView
        deliverableId={deliverable.id}
        bodyMarkdown={deliverable.body_markdown ?? ""}
        citations={citations}
        status={deliverable.status}
        scope={deliverable.scope}
      />
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
