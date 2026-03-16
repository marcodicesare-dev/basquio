import { LinearClient } from "@linear/sdk";
import type { ExtractedActionItem } from "@basquio/types";
import { env, TEAM_MEMBERS } from "./config.js";

let client: LinearClient;

function getClient(): LinearClient {
  if (!client) {
    client = new LinearClient({ apiKey: env.LINEAR_API_KEY });
  }
  return client;
}

// Label name → ID cache (populated on first use)
const labelCache = new Map<string, string>();

// User display name → ID cache
const userCache = new Map<string, string>();

/**
 * Ensure all required labels exist, creating them if needed.
 */
export async function ensureLabels(): Promise<void> {
  const linear = getClient();

  const requiredLabels: Record<string, string> = {
    bug: "#eb5757",
    feature: "#4da375",
    improvement: "#f2c94c",
    feedback: "#2d9cdb",
    "from-voice": "#9b51e0",
    "from-text": "#56ccf2",
    finance: "#27ae60",
    marketing: "#ff6b9d",
    sales: "#eb5757",
  };

  // Fetch existing labels (team + workspace level)
  const existingLabels = await linear.issueLabels();

  for (const label of existingLabels.nodes) {
    labelCache.set(label.name.toLowerCase(), label.id);
  }

  // Create missing labels (Linear label names are case-insensitive)
  for (const [name, color] of Object.entries(requiredLabels)) {
    if (!labelCache.has(name)) {
      try {
        const result = await linear.createIssueLabel({
          name,
          color,
          teamId: env.LINEAR_TEAM_ID,
        });
        const created = await result.issueLabel;
        if (created) {
          labelCache.set(name, created.id);
          console.log(`📎 Created Linear label: ${name}`);
        }
      } catch (err: unknown) {
        // Label may already exist with different casing (e.g. "Bug" vs "bug")
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("duplicate") || msg.includes("already exists")) {
          console.log(`📎 Label "${name}" already exists in workspace, skipping`);
        } else {
          throw err;
        }
      }
    }
  }
}

/**
 * Cache Linear user IDs by display name + all team aliases.
 */
async function ensureUserCache(): Promise<void> {
  if (userCache.size > 0) return;
  const linear = getClient();
  const users = await linear.users();
  for (const user of users.nodes) {
    userCache.set(user.displayName.toLowerCase(), user.id);
    userCache.set(user.name.toLowerCase(), user.id);
  }

  // Add team member aliases → their Linear user ID
  for (const member of Object.values(TEAM_MEMBERS)) {
    const linearId = userCache.get(member.linearDisplayName.toLowerCase());
    if (linearId) {
      for (const alias of member.aliases) {
        userCache.set(alias.toLowerCase(), linearId);
      }
    }
  }

  console.log(`👥 Linear user cache: ${userCache.size} entries (${users.nodes.length} users + aliases)`);
}

/**
 * Resolve a team member name to a Linear user ID.
 * Checks exact match, then partial match against cached names.
 */
function resolveAssignee(name: string): string | undefined {
  const key = name.toLowerCase();
  const exact = userCache.get(key);
  if (exact) return exact;

  // Partial match: "Marco" should match "marco.dicesare"
  for (const [cachedName, id] of userCache.entries()) {
    if (cachedName.startsWith(key) || key.startsWith(cachedName)) {
      return id;
    }
  }
  return undefined;
}

export interface CreatedIssue {
  identifier: string; // e.g. "BAS-42"
  title: string;
  url: string;
  assignee: string;
  labels: string[];
}

/**
 * Create Linear issues from extracted action items.
 * Deduplicates by checking for recent issues with similar titles.
 */
export async function createIssues(
  actionItems: ExtractedActionItem[],
  transcriptUrl: string,
  sessionType: "voice" | "text",
): Promise<CreatedIssue[]> {
  const linear = getClient();
  if (labelCache.size === 0) await ensureLabels();
  await ensureUserCache();

  // Hard cap: max 2 issues per session to force consolidation
  const capped = actionItems.slice(0, 2);
  if (actionItems.length > 2) {
    console.log(`📎 Capped issues from ${actionItems.length} → 2 (consolidation)`);
  }

  const created: CreatedIssue[] = [];

  for (const item of capped) {
    // Deduplication: check for recent similar issues
    const existing = await linear.issues({
      filter: {
        team: { id: { eq: env.LINEAR_TEAM_ID } },
        title: { contains: item.title.substring(0, 30) },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
      },
    });

    if (existing.nodes.length > 0) {
      console.log(`⏭️ Skipping duplicate issue: "${item.title}"`);
      continue;
    }

    // Resolve labels
    const labelIds: string[] = [];
    const labelNames: string[] = [];

    const categoryLabel = labelCache.get(item.category);
    if (categoryLabel) {
      labelIds.push(categoryLabel);
      labelNames.push(item.category);
    }

    const sourceLabel = labelCache.get(sessionType === "voice" ? "from-voice" : "from-text");
    if (sourceLabel) {
      labelIds.push(sourceLabel);
      labelNames.push(sessionType === "voice" ? "from-voice" : "from-text");
    }

    // Resolve assignee + add color-coded assignee label
    const assigneeId = resolveAssignee(item.assignee);
    const assigneeLabelName = item.assignee.toLowerCase();
    const assigneeLabel = labelCache.get(assigneeLabelName);
    if (assigneeLabel) {
      labelIds.push(assigneeLabel);
      labelNames.push(assigneeLabelName);
    }

    // Build description with proper links
    const sourceLines: string[] = [];
    if (transcriptUrl && transcriptUrl !== "text-session") {
      sourceLines.push(`Source: [Transcript](${transcriptUrl})`);
    }
    sourceLines.push(
      `Extracted by Basquio Bot from ${sessionType === "voice" ? "🎙️ voice" : "💬 text"} session`,
    );

    const description = [
      `> "${item.description}"`,
      "",
      `— ${item.assignee}, ${new Date().toLocaleDateString("en-GB")}`,
      "",
      "---",
      ...sourceLines,
    ].join("\n");

    // Map priority
    const priorityMap: Record<string, number> = {
      urgent: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    try {
      const result = await linear.createIssue({
        teamId: env.LINEAR_TEAM_ID,
        title: item.title,
        description,
        labelIds,
        assigneeId,
        priority: priorityMap[item.priority] ?? 3,
      });

      const issue = await result.issue;
      if (issue) {
        created.push({
          identifier: issue.identifier,
          title: item.title,
          url: issue.url,
          assignee: item.assignee,
          labels: labelNames,
        });
        console.log(`✅ Created issue ${issue.identifier}: ${item.title}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If label is not associated with team, retry without labels
      if (msg.includes("label") && msg.includes("team")) {
        console.warn(`⚠️ Label/team mismatch for "${item.title}", retrying without labels`);
        try {
          const result = await linear.createIssue({
            teamId: env.LINEAR_TEAM_ID,
            title: item.title,
            description,
            assigneeId,
            priority: priorityMap[item.priority] ?? 3,
          });
          const issue = await result.issue;
          if (issue) {
            created.push({
              identifier: issue.identifier,
              title: item.title,
              url: issue.url,
              assignee: item.assignee,
              labels: [],
            });
            console.log(`✅ Created issue ${issue.identifier}: ${item.title} (no labels)`);
          }
        } catch (retryErr) {
          console.error(`❌ Failed to create issue "${item.title}":`, retryErr);
        }
      } else {
        console.error(`❌ Failed to create issue "${item.title}":`, err);
      }
    }
  }

  return created;
}
