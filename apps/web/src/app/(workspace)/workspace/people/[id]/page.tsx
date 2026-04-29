import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { StakeholderProfileEditor } from "@/components/workspace-stakeholder-editor";
import { getViewerState } from "@/lib/supabase/auth";
import { getWorkspacePersonProfile } from "@/lib/workspace/people";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getWorkspacePersonProfile(id).catch(() => null);
  return { title: profile ? `${profile.canonical_name} · People · Basquio` : "People · Basquio" };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function WorkspacePersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const viewer = await getViewerState();
  const workspace = await getCurrentWorkspace(viewer);
  const profile = await getWorkspacePersonProfile(id);
  if (!profile || profile.workspace_id !== workspace.id) notFound();

  const company = profile.metadata.company as string | undefined;
  const role = profile.metadata.role as string | undefined;

  return (
    <div className="wbeta-person-page">
      <WorkspaceBreadcrumb
        items={[
          { href: "/workspace", label: "Home" },
          { href: "/workspace/people", label: "People" },
          { label: profile.canonical_name },
        ]}
      />

      <header className="wbeta-person-head">
        <p className="wbeta-person-eyebrow">Stakeholder</p>
        <h1 className="wbeta-person-title">{profile.canonical_name}</h1>
        {role || company ? (
          <p className="wbeta-person-subtitle">
            {role}
            {role && company ? " · " : ""}
            {company}
          </p>
        ) : null}
        {profile.aliases.length > 0 ? (
          <p className="wbeta-person-aliases">
            Also known as: {profile.aliases.join(", ")}
          </p>
        ) : null}
      </header>

      <div className="wbeta-person-grid">
        <div className="wbeta-person-main">
          <StakeholderProfileEditor
            personId={profile.id}
            initial={{
              role: role ?? "",
              company: company ?? "",
              preferences: profile.metadata.preferences ?? {},
              notes: (profile.metadata.notes as string | undefined) ?? "",
            }}
          />

          <section className="wbeta-person-section">
            <header className="wbeta-person-section-head">
              <h2 className="wbeta-person-section-title">Facts</h2>
              <p className="wbeta-person-section-meta">
                {profile.facts.length > 0 ? `${profile.facts.length} grounded` : "No facts yet"}
              </p>
            </header>
            {profile.facts.length === 0 ? (
              <p className="wbeta-person-section-empty">
                Upload briefs, meeting transcripts, or deck decks that reference {profile.canonical_name}.
                Basquio extracts facts here automatically.
              </p>
            ) : (
              <ul className="wbeta-person-facts">
                {profile.facts.map((fact) => (
                  <li key={fact.id}>
                    <div className="wbeta-person-fact-row">
                      <span className="wbeta-person-fact-predicate">
                        {fact.predicate.replace(/_/g, " ")}
                      </span>
                      <span className="wbeta-person-fact-value">{formatFactValue(fact.object_value)}</span>
                      {fact.valid_from ? (
                        <span className="wbeta-person-fact-when">
                          {new Date(fact.valid_from).toLocaleDateString(undefined, {
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      ) : null}
                    </div>
                    {fact.evidence ? (
                      <p className="wbeta-person-fact-evidence">{`"${fact.evidence}"`}</p>
                    ) : null}
                    {fact.document_filename ? (
                      <p className="wbeta-person-fact-source">From {fact.document_filename}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="wbeta-person-section">
            <header className="wbeta-person-section-head">
              <h2 className="wbeta-person-section-title">Recent mentions</h2>
              <p className="wbeta-person-section-meta">
                {profile.mentions.length > 0 ? `${profile.mentions.length} sources` : "No mentions yet"}
              </p>
            </header>
            {profile.mentions.length === 0 ? (
              <p className="wbeta-person-section-empty">
                Mentions appear here the moment {profile.canonical_name} shows up in a new upload.
              </p>
            ) : (
              <ul className="wbeta-person-mentions">
                {profile.mentions.map((mention) => (
                  <li key={mention.id} className="wbeta-person-mention">
                    <p className="wbeta-person-mention-src">
                      {mention.document_filename ?? `${mention.source_type}:${mention.source_id.slice(0, 8)}`}
                    </p>
                    {mention.excerpt ? (
                      <p className="wbeta-person-mention-excerpt">{mention.excerpt}</p>
                    ) : null}
                    <p className="wbeta-person-mention-date">{formatDate(mention.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="wbeta-person-aside">
          <section className="wbeta-person-section">
            <header className="wbeta-person-section-head">
              <h2 className="wbeta-person-section-title">Linked deliverables</h2>
            </header>
            {profile.deliverables.length === 0 ? (
              <p className="wbeta-person-section-empty">
                None yet. Deliverables land here when they mention {profile.canonical_name}.
              </p>
            ) : (
              <ul className="wbeta-person-deliverables">
                {profile.deliverables.map((d) => (
                  <li key={d.id}>
                    <Link href={`/workspace/deliverable/${d.id}`} className="wbeta-person-deliverable">
                      <span className="wbeta-person-deliverable-title">{d.title}</span>
                      <span className="wbeta-person-deliverable-meta">
                        {d.kind} · {d.scope ?? "workspace"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatFactValue(value: unknown): string {
  if (value == null) return "unknown";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("value" in obj) {
      const parts = [String(obj.value ?? "")];
      if (obj.unit) parts.push(String(obj.unit));
      if (obj.period) parts.push(`(${obj.period})`);
      return parts.join(" ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const diff = Math.round((Date.now() - date.getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
