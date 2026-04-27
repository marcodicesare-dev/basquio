import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

type SkillEntry = {
  name: string;
  hasSkillMd: boolean;
  description: string;
};

function listSkillsFromDisk(): SkillEntry[] {
  const root = join(process.cwd(), "..", "..", "skills");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // Vercel runtime: cwd is the app dir, skills/ may not be at the
    // expected relative path. Fall back to a static list of skills
    // shipped on origin/main for the v1 admin surface.
    return [
      { name: "basquio-foundation", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-cpg-storytelling", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-intelligence", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-market-intelligence", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-rendering", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-runtime-forensics", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-stack-context", hasSkillMd: true, description: "(filesystem listing not available in this runtime)" },
      { name: "basquio-brand-extraction", hasSkillMd: true, description: "Brief 3 brand-guideline extraction (filesystem listing not available in this runtime)" },
    ];
  }
  const out: SkillEntry[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    let hasSkillMd = false;
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) continue;
      const skillPath = join(dir, "SKILL.md");
      hasSkillMd = statSync(skillPath).isFile();
    } catch {
      hasSkillMd = false;
    }
    out.push({ name, hasSkillMd, description: hasSkillMd ? "Loaded skill" : "Folder without SKILL.md" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export default async function AdminSkillsPage() {
  const skills = listSkillsFromDisk();
  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Skills inventory</h2>
        <p className="wbeta-admin-summary">
          Read-only inventory of <code>skills/</code> directories shipped on origin/main. Skills
          are loaded by the deck pipeline (deck pipeline is out of scope for the memory v1
          admin surface; skill changes ship via code commit).
        </p>
      </header>

      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>SKILL.md</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {skills.length === 0 ? (
            <tr>
              <td colSpan={3} className="wbeta-admin-summary">
                No skills directory readable from the runtime.
              </td>
            </tr>
          ) : null}
          {skills.map((s) => (
            <tr key={s.name}>
              <td className="wbeta-admin-mono">{s.name}</td>
              <td>{s.hasSkillMd ? "yes" : "no"}</td>
              <td>{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
