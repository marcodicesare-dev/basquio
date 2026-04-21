import { createHash } from "node:crypto";

import {
  workspaceContextPackSchema,
  type WorkspaceContextPack,
} from "@basquio/types";

export type WorkspaceContextSupportPacket = {
  filename: string;
  content: string;
};

export function parseWorkspaceContextPack(value: unknown): WorkspaceContextPack | null {
  if (!value) {
    return null;
  }

  const parsed = workspaceContextPackSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hashWorkspaceContextPack(pack: WorkspaceContextPack | null) {
  if (!pack) {
    return null;
  }

  return createHash("sha256").update(stableStringify(pack)).digest("hex");
}

export function buildWorkspaceContextSummary(pack: WorkspaceContextPack | null) {
  if (!pack) {
    return "";
  }

  const scopeName = pack.scope.name ?? "Unscoped";
  const workspaceRules = pack.rules.workspace.length + pack.rules.analyst.length + pack.rules.scoped.length;

  return [
    `Workspace context hash: ${hashWorkspaceContextPack(pack) ?? "unavailable"}`,
    `Workspace ID: ${pack.workspaceId}`,
    `Scope: ${scopeName}`,
    `Deliverable: ${pack.deliverableId ?? "none"}`,
    `Lineage: conversation=${pack.lineage.conversationId ?? "none"}, message=${pack.lineage.messageId ?? "none"}, source=${pack.lineage.launchSource}`,
    `Stakeholders: ${pack.stakeholders.length}`,
    `Rules: ${workspaceRules}`,
    `Cited sources: ${pack.citedSources.length}`,
    `Attached source files: ${pack.sourceFiles.length}`,
    pack.renderedBriefPrelude.trim()
      ? `Rendered prelude:\n${pack.renderedBriefPrelude.trim()}`
      : "Rendered prelude: none",
  ].join("\n");
}

export function buildWorkspaceContextSupportPackets(pack: WorkspaceContextPack | null): WorkspaceContextSupportPacket[] {
  if (!pack) {
    return [];
  }

  return [
    {
      filename: "workspace-context.md",
      content: buildWorkspaceContextMarkdown(pack),
    },
    {
      filename: "workspace-context.json",
      content: `${JSON.stringify(pack, null, 2)}\n`,
    },
  ];
}

function buildWorkspaceContextMarkdown(pack: WorkspaceContextPack) {
  const sections: string[] = [
    "# Workspace Context Pack",
    "",
    `Schema version: ${pack.schemaVersion}`,
    `Created at: ${pack.createdAt}`,
    `Workspace ID: ${pack.workspaceId}`,
    `Workspace scope ID: ${pack.workspaceScopeId ?? "None"}`,
    `Deliverable ID: ${pack.deliverableId ?? "None"}`,
    `Launch source: ${pack.lineage.launchSource}`,
    `Conversation ID: ${pack.lineage.conversationId ?? "None"}`,
    `Message ID: ${pack.lineage.messageId ?? "None"}`,
    `Deliverable title: ${pack.lineage.deliverableTitle ?? "None"}`,
    `Prompt: ${pack.lineage.prompt ?? "None"}`,
    "",
    "## Scope",
    `- ID: ${pack.scope.id ?? "None"}`,
    `- Kind: ${pack.scope.kind ?? "None"}`,
    `- Name: ${pack.scope.name ?? "None"}`,
    "",
    "## Rendered Brief Prelude",
    pack.renderedBriefPrelude.trim() || "None",
    "",
    "## Stakeholders",
    ...(pack.stakeholders.length > 0
      ? pack.stakeholders.flatMap((stakeholder) => [
          `- ${stakeholder.name} (${stakeholder.role ?? "unspecified role"})`,
          `  Preferences: ${Object.keys(stakeholder.preferences).length > 0 ? JSON.stringify(stakeholder.preferences) : "{}"}`,
        ])
      : ["- None"]),
    "",
    "## Rules",
    "### Workspace",
    ...(pack.rules.workspace.length > 0 ? pack.rules.workspace.map((rule) => `- ${rule}`) : ["- None"]),
    "",
    "### Analyst",
    ...(pack.rules.analyst.length > 0 ? pack.rules.analyst.map((rule) => `- ${rule}`) : ["- None"]),
    "",
    "### Scoped",
    ...(pack.rules.scoped.length > 0 ? pack.rules.scoped.map((rule) => `- ${rule}`) : ["- None"]),
    "",
    "## Cited Sources",
    ...(pack.citedSources.length > 0
      ? pack.citedSources.map((source) => `- ${source.fileName} (document=${source.documentId}, source_file=${source.sourceFileId ?? "None"})`)
      : ["- None"]),
    "",
    "## Source Files",
    ...(pack.sourceFiles.length > 0
      ? pack.sourceFiles.map((file) => `- ${file.fileName} [${file.kind}] (${file.storageBucket}/${file.storagePath})`)
      : ["- None"]),
    "",
    "## Style Contract",
    `- Language: ${pack.styleContract.language ?? "None"}`,
    `- Tone: ${pack.styleContract.tone ?? "None"}`,
    `- Deck length: ${pack.styleContract.deckLength ?? "None"}`,
    `- Chart preferences: ${pack.styleContract.chartPreferences.length > 0 ? pack.styleContract.chartPreferences.join(", ") : "None"}`,
  ];

  return `${sections.join("\n")}\n`;
}

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
