import assert from "node:assert/strict";

import {
  workspaceContextPackSchema,
  type WorkspaceContextPack,
} from "@basquio/types";
import {
  buildWorkspaceContextSupportPackets,
  hashWorkspaceContextPack,
  parseWorkspaceContextPack,
} from "../packages/workflows/src/workspace-context";
import {
  canonicalizeWorkspaceContextPack as canonicalizeWebWorkspaceContextPack,
  resolveAuthoritativeWorkspaceContextPack as resolveAuthoritativeWebWorkspaceContextPack,
} from "../apps/web/src/lib/workspace-context-pack";

function buildFixture(): WorkspaceContextPack {
  return workspaceContextPackSchema.parse({
    workspaceId: "workspace-123",
    workspaceScopeId: "scope-456",
    deliverableId: "deliverable-789",
    scope: {
      id: "scope-456",
      kind: "account",
      name: "North America Grocery",
    },
    stakeholders: [
      {
        id: "stakeholder-1",
        name: "Jane Doe",
        role: "VP Category",
        preferences: {
          tone: "opportunity-first",
        },
      },
    ],
    rules: {
      workspace: ["Use client naming exactly."],
      analyst: ["Quantify claims before recommending action."],
      scoped: ["Prioritize grocery over total market."],
    },
    citedSources: [
      {
        documentId: "doc-1",
        fileName: "category-playbook.pdf",
        sourceFileId: "source-file-1",
      },
    ],
    sourceFiles: [
      {
        id: "source-file-1",
        kind: "pdf",
        fileName: "category-playbook.pdf",
        storageBucket: "source-files",
        storagePath: "org/project/category-playbook.pdf",
      },
    ],
    lineage: {
      conversationId: "conversation-1",
      messageId: "message-2",
      deliverableTitle: "Q2 retailer deck",
      prompt: "Turn the memo into a 10-slide executive deck.",
      launchSource: "workspace-chat",
    },
    styleContract: {
      language: "en",
      tone: "executive",
      deckLength: "10 slides",
      chartPreferences: ["scatter", "grouped_bar"],
    },
    renderedBriefPrelude: "# Workspace context\n\nLead with retailer implications and keep the tone opportunity-first.",
    createdAt: "2026-04-21T09:30:00.000Z",
    schemaVersion: 1,
  });
}

async function main() {
  const fixture = buildFixture();
  const parsed = parseWorkspaceContextPack(JSON.parse(JSON.stringify(fixture)));
  assert.ok(parsed, "expected workspace context pack to parse");

  const firstHash = hashWorkspaceContextPack(fixture);
  const secondHash = hashWorkspaceContextPack(parsed);
  assert.equal(firstHash, secondHash, "expected workspace context hash to be stable after roundtrip");

  const packets = buildWorkspaceContextSupportPackets(parsed);
  assert.equal(packets.length, 2, "expected markdown and json workspace support packets");
  assert.ok(packets.some((packet) => packet.filename === "workspace-context.md"), "expected workspace markdown packet");
  assert.ok(packets.some((packet) => packet.filename === "workspace-context.json"), "expected workspace json packet");

  const markdownPacket = packets.find((packet) => packet.filename === "workspace-context.md");
  assert.ok(markdownPacket?.content.includes("North America Grocery"), "expected scope metadata in markdown packet");
  assert.ok(markdownPacket?.content.includes("Lead with retailer implications"), "expected rendered prelude in markdown packet");
  assert.ok(markdownPacket?.content.includes("Jane Doe"), "expected stakeholder metadata in markdown packet");

  const canonicalized = canonicalizeWebWorkspaceContextPack(parsed, [
    {
      id: "source-file-1",
      kind: "pdf",
      fileName: "trusted-category-playbook.pdf",
      storageBucket: "knowledge-base",
      storagePath: "trusted/path/playbook.pdf",
    },
  ]);
  assert.ok(canonicalized, "expected canonicalized workspace context pack");
  assert.equal(canonicalized?.workspaceScopeId, "scope-456", "expected canonicalized scope id");
  assert.equal(canonicalized?.sourceFiles.length, 1, "expected only attached source files to survive canonicalization");
  assert.equal(canonicalized?.sourceFiles[0]?.fileName, "trusted-category-playbook.pdf", "expected source file metadata to be server-canonicalized");
  assert.equal(canonicalized?.sourceFiles[0]?.storageBucket, "knowledge-base", "expected canonical source bucket");
  assert.equal(canonicalized?.citedSources[0]?.sourceFileId, "source-file-1", "expected trusted cited source linkage to survive");

  const canonicalizedWithoutAttachment = canonicalizeWebWorkspaceContextPack(parsed, []);
  assert.equal(canonicalizedWithoutAttachment?.sourceFiles.length, 0, "expected unattached source files to be removed");
  assert.equal(canonicalizedWithoutAttachment?.citedSources[0]?.sourceFileId, null, "expected unattached cited source linkage to be nulled");

  const persistedPack = workspaceContextPackSchema.parse({
    ...fixture,
    sourceFiles: [
      {
        id: "source-file-1",
        kind: "pdf",
        fileName: "persisted-playbook.pdf",
        storageBucket: "knowledge-base",
        storagePath: "persisted/path/playbook.pdf",
      },
    ],
  });
  const resolved = resolveAuthoritativeWebWorkspaceContextPack({
    persistedPack,
    clientPack: parsed,
    attachedSourceFiles: [
      {
        id: "source-file-1",
        kind: "pdf",
        fileName: "attached-playbook.pdf",
        storageBucket: "knowledge-base",
        storagePath: "attached/path/playbook.pdf",
      },
    ],
  });
  assert.equal(resolved?.sourceFiles[0]?.fileName, "attached-playbook.pdf", "expected authoritative resolution to canonicalize against current attached files");
  assert.equal(resolved?.renderedBriefPrelude, persistedPack.renderedBriefPrelude, "expected persisted pack to win over client pack on reruns");

  process.stdout.write("workspace context pack regression passed\n");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
