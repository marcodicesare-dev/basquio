import Link from "next/link";

import { WorkspaceBreadcrumb } from "@/components/workspace-breadcrumb";
import { listWorkspacePeople } from "@/lib/workspace/people";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "People · Basquio",
};

export default async function WorkspacePeoplePage() {
  const workspace = await getCurrentWorkspace();
  const people = await listWorkspacePeople(workspace.id);

  const grouped = new Map<string, typeof people>();
  for (const person of people) {
    const key = (person.metadata.company as string | undefined) ?? "Unlinked";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(person);
  }
  const groupedEntries = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="wbeta-people-page">
      <WorkspaceBreadcrumb
        items={[{ href: "/workspace", label: "Home" }, { label: "People" }]}
      />

      <header className="wbeta-people-head">
        <p className="wbeta-people-eyebrow">People</p>
        <h1 className="wbeta-people-title">Your stakeholders and collaborators.</h1>
        <p className="wbeta-people-summary">
          Every person Basquio has learned about shows up here. Open a profile to set preferences,
          add a note, or link a stakeholder to a scope. These preferences inform every answer.
        </p>
      </header>

      {people.length === 0 ? (
        <div className="wbeta-people-empty">
          <h3 className="wbeta-people-empty-title">No people yet.</h3>
          <p className="wbeta-people-empty-body">
            Upload a brief, a meeting transcript, or a prior deck. Basquio extracts the stakeholders
            mentioned and lands them here.
          </p>
        </div>
      ) : (
        <div className="wbeta-people-groups">
          {groupedEntries.map(([company, members]) => (
            <section key={company} className="wbeta-people-group">
              <header className="wbeta-people-group-head">
                <h2 className="wbeta-people-group-title">{company}</h2>
                <p className="wbeta-people-group-count">
                  {members.length} {members.length === 1 ? "person" : "people"}
                </p>
              </header>
              <ul className="wbeta-people-list">
                {members.map((person) => {
                  const role = person.metadata.role as string | undefined;
                  const prefs = person.metadata.preferences?.structured;
                  const prefCount = prefs ? Object.keys(prefs).filter((k) => prefs[k]).length : 0;
                  return (
                    <li key={person.id}>
                      <Link href={`/workspace/people/${person.id}`} className="wbeta-people-card">
                        <span className="wbeta-people-card-name">{person.canonical_name}</span>
                        {role ? (
                          <span className="wbeta-people-card-role">{role}</span>
                        ) : null}
                        {prefCount > 0 ? (
                          <span className="wbeta-people-card-pref">
                            {prefCount} preference{prefCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
