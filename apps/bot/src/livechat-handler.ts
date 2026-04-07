import type { Message } from "discord.js";
import type { ExtractionResult, ExtractedActionItem, ExtractedSalesMention } from "@basquio/types";
import { ASSIGNMENT_RULES, env, LIVECHAT_INACTIVITY_MS } from "./config.js";
import { postSessionSummary } from "./discord.js";
import { extractFromLivechat, type LivechatExtraction } from "./livechat-extractor.js";
import { resolveIntercomAdminId } from "./intercom-admins.js";
import { createIssues } from "./linear.js";
import { embedAndStoreTranscript } from "./transcript-embedder.js";
import { getIntercomThreadByDiscordThreadId, saveTranscript, upsertLead } from "./supabase.js";

interface BufferedLivechatMessage {
  id: string;
  role: "customer" | "team";
  author: string;
  content: string;
  timestamp: Date;
}

interface LivechatSession {
  startedAt: Date;
  messages: BufferedLivechatMessage[];
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  customerName: string | null;
  customerEmail: string | null;
  intercomConversationId: string | null;
  guildId: string | null;
}

const livechatSessions = new Map<string, LivechatSession>();
const processedMessageIds = new Set<string>();
const MAX_PROCESSED_IDS = 2000;
const BOT_STARTED_AT = new Date();
const INTERCOM_API_VERSION = "2.13";
const LIVECHAT_STARTER_PREFIXES = ["Incoming Intercom chat from", "📩 New live chat from"];

export async function handleLivechatReply(message: Message): Promise<void> {
  if (!message.channel.isThread()) return;

  if (!env.INTERCOM_ACCESS_TOKEN) {
    console.warn("⚠️ Livechat reply skipped — Intercom env vars are not configured");
    await safeReact(message, "❌");
    return;
  }

  const mapping = await getIntercomThreadByDiscordThreadId(message.channelId);
  if (!mapping) {
    console.warn(`⚠️ No Intercom mapping found for Discord thread ${message.channelId}`);
    await safeReact(message, "❌");
    return;
  }

  const replyBody = buildIntercomReplyBody(message);
  if (!replyBody) {
    console.warn(`⚠️ Empty livechat reply for thread ${message.channelId}`);
    await safeReact(message, "❌");
    return;
  }

  const discordName = message.member?.displayName ?? message.author.username;
  const adminId = resolveIntercomAdminId(discordName) ?? env.INTERCOM_ADMIN_ID;
  if (!adminId) {
    console.warn(`⚠️ No Intercom admin ID resolved for ${discordName}`);
    await safeReact(message, "❌");
    return;
  }

  const response = await fetch(
    `${env.INTERCOM_API_BASE_URL}/conversations/${mapping.intercom_conversation_id}/reply`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.INTERCOM_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": INTERCOM_API_VERSION,
      },
      body: JSON.stringify({
        message_type: "comment",
        type: "admin",
        admin_id: adminId,
        body: replyBody,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`❌ Intercom reply failed for ${mapping.intercom_conversation_id}: ${response.status} ${text}`);
    await safeReact(message, "❌");
    return;
  }

  await safeReact(message, "✅");
  console.log(`✅ Forwarded Discord reply to Intercom conversation ${mapping.intercom_conversation_id}`);
}

export async function bufferLivechatMessage(message: Message): Promise<void> {
  if (!message.channel.isThread()) return;
  if (message.createdAt < BOT_STARTED_AT) return;
  if (processedMessageIds.has(message.id)) return;

  const isCustomerRelay = message.author.id === message.client.user?.id || !!message.webhookId;
  if (message.author.bot && !isCustomerRelay) return;

  const content = buildBufferedContent(message, isCustomerRelay);
  if (!content) return;

  let session = livechatSessions.get(message.channelId);
  if (!session) {
    const mapping = await loadLivechatMapping(message.channelId);
    session = {
      startedAt: message.createdAt,
      messages: [],
      inactivityTimer: null,
      customerName: mapping?.customer_name ?? null,
      customerEmail: mapping?.customer_email ?? null,
      intercomConversationId: mapping?.intercom_conversation_id ?? null,
      guildId: message.guildId,
    };
    livechatSessions.set(message.channelId, session);
  } else if (!hasCompleteSessionMetadata(session)) {
    const mapping = await loadLivechatMapping(message.channelId);
    if (mapping) {
      hydrateLivechatSession(session, mapping);
    }
  }

  const author = isCustomerRelay
    ? buildCustomerAuthorLabel(session, message.webhookId ? message.author.username : null)
    : message.member?.displayName ?? message.author.username;

  session.messages.push({
    id: message.id,
    role: isCustomerRelay ? "customer" : "team",
    author,
    content,
    timestamp: message.createdAt,
  });

  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
  }
  session.inactivityTimer = setTimeout(() => {
    flushLivechatThread(message.channelId).catch((error) => {
      console.error(`❌ Livechat flush failed for ${message.channelId}:`, error);
    });
  }, LIVECHAT_INACTIVITY_MS);
}

async function flushLivechatThread(threadId: string): Promise<void> {
  const session = livechatSessions.get(threadId);
  if (!session) return;

  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
  }
  livechatSessions.delete(threadId);

  if (session.messages.length === 0) return;

  markProcessed(session.messages.map((message) => message.id));

  const startedAt = session.startedAt;
  const endedAt = session.messages[session.messages.length - 1]!.timestamp;
  const hasCustomerMessages = session.messages.some((message) => message.role === "customer");
  const transcript = session.messages
    .map((message) => `[${message.role === "customer" ? `Customer: ${message.author}` : `Team: ${message.author}`}]: ${message.content}`)
    .join("\n");
  const participants = [...new Set(session.messages.map((message) => message.author))];

  const extraction = hasCustomerMessages
    ? await extractFromLivechat(transcript)
    : buildEmptyLivechatExtraction(session);
  const normalizedExtraction = normalizeExtraction(extraction);

  const transcriptId = await saveTranscript({
    sessionType: "livechat",
    startedAt,
    endedAt,
    participants,
    rawTranscript: transcript,
    extraction: normalizedExtraction,
    metadata: {
      source: "livechat",
      customer: extraction.customer,
      sentiment: extraction.sentiment,
      category: extraction.category,
      resolution: extraction.resolution,
      discord_thread_id: threadId,
      intercom_conversation_id: session.intercomConversationId,
    },
  });

  embedAndStoreTranscript(transcriptId, transcript).catch((error) => {
    console.error(`Failed to embed livechat transcript ${transcriptId}:`, error);
  });

  const transcriptUrl = session.guildId
    ? `https://discord.com/channels/${session.guildId}/${threadId}`
    : `discord-thread:${threadId}`;

  let issues: Awaited<ReturnType<typeof createIssues>> = [];
  if (normalizedExtraction.action_items.length > 0) {
    issues = await createIssues(normalizedExtraction.action_items, transcriptUrl, "livechat");
  }

  const crmUpdates: string[] = [];
  for (const mention of normalizedExtraction.sales_mentions) {
    await upsertLead(mention, transcriptId);
    crmUpdates.push(`${mention.company} — ${mention.status}`);
  }

  await postSessionSummary({
    sessionType: "livechat",
    duration: formatDuration(endedAt.getTime() - startedAt.getTime()),
    participants,
    extraction: normalizedExtraction,
    issues,
    transcriptUrl,
    crmUpdates,
    alertPrefix: shouldAlert(extraction) ? "@here" : null,
  });

  console.log(
    `🛟 Livechat session processed: ${session.intercomConversationId ?? threadId} | ${issues.length} issues | ${crmUpdates.length} leads`,
  );
}

function normalizeExtraction(extraction: LivechatExtraction): ExtractionResult {
  return {
    summary: extraction.summary,
    decisions: [],
    action_items: buildActionItems(extraction),
    sales_mentions: buildSalesMentions(extraction),
    key_quotes: extraction.keyQuotes,
  };
}

function buildActionItems(extraction: LivechatExtraction): ExtractedActionItem[] {
  const bugAssignee = ASSIGNMENT_RULES["bug-report-livechat"]?.[0] ?? "Marco";
  const featureAssignee = ASSIGNMENT_RULES["feature-request-livechat"]?.[0] ?? "Veronica";
  const customerContext = buildCustomerContext(extraction);

  const bugItems = extraction.bugReports.map<ExtractedActionItem>((report) => ({
    title: report.title,
    description: customerContext
      ? `${report.description}\n\n${customerContext}`
      : report.description,
    category: "bug",
    assignee: bugAssignee,
    priority: severityToPriority(report.severity),
  }));

  const featureItems = extraction.featureRequests.map<ExtractedActionItem>((request) => ({
    title: request.title,
    description: customerContext
      ? `${request.description}\n\n${customerContext}`
      : request.description,
    category: "feature",
    assignee: featureAssignee,
    priority: request.priority,
  }));

  return [...bugItems, ...featureItems];
}

function buildSalesMentions(extraction: LivechatExtraction): ExtractedSalesMention[] {
  const salesOwner = ASSIGNMENT_RULES["sales-signal-livechat"]?.[0] ?? "Ale";
  const customerContext = buildCustomerContext(extraction);

  return extraction.salesSignals.map((signal) => ({
    company: signal.company,
    context: customerContext ? `${signal.signal}\n\n${customerContext}` : signal.signal,
    action: signal.contact ? `Follow up with ${signal.contact}` : undefined,
    owner: salesOwner,
    status: signal.status,
  }));
}

function buildCustomerContext(extraction: LivechatExtraction): string {
  const parts = [
    extraction.customer.name,
    extraction.customer.email,
    extraction.customer.company,
  ].filter((value): value is string => !!value?.trim());

  return parts.length > 0 ? `Customer context: ${parts.join(" | ")}` : "";
}

function severityToPriority(severity: "critical" | "high" | "medium" | "low"): "urgent" | "high" | "medium" | "low" {
  if (severity === "critical") return "urgent";
  if (severity === "high") return "high";
  if (severity === "low") return "low";
  return "medium";
}

function buildIntercomReplyBody(message: Message): string {
  const content = message.cleanContent.trim();
  const attachmentLines = [...message.attachments.values()].map((attachment) => attachment.url);
  const fullText = [content, attachmentLines.length > 0 ? `Attachments:\n${attachmentLines.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!fullText) return "";

  return fullText
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function buildBufferedContent(message: Message, isCustomerRelay: boolean): string {
  const base = isCustomerRelay
    ? normalizeCustomerRelayContent(message.content)
    : message.cleanContent.trim();
  const attachmentLines = !isCustomerRelay
    ? [...message.attachments.values()].map((attachment) => attachment.url)
    : [];

  return [base, attachmentLines.length > 0 ? `Attachments:\n${attachmentLines.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmptyLivechatExtraction(session: LivechatSession): LivechatExtraction {
  return {
    customer: {
      name: session.customerName,
      email: session.customerEmail,
      company: null,
    },
    sentiment: "neutral",
    category: "general",
    summary: "No customer message was captured before the team responded, so AI extraction was skipped for this thread.",
    resolution: null,
    featureRequests: [],
    bugReports: [],
    salesSignals: [],
    keyQuotes: [],
  };
}

function normalizeCustomerRelayContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (LIVECHAT_STARTER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return "";
  }

  return trimmed
    .split("\n")
    .map((line) => line.startsWith("> ") ? line.slice(2) : line)
    .join("\n")
    .trim();
}

async function loadLivechatMapping(threadId: string) {
  return getIntercomThreadByDiscordThreadId(threadId).catch((error) => {
    console.error(`Failed to load livechat mapping for ${threadId}:`, error);
    return null;
  });
}

function hasCompleteSessionMetadata(session: LivechatSession): boolean {
  if (!session.intercomConversationId) {
    return false;
  }

  const customerName = session.customerName?.trim().toLowerCase() ?? "";
  const hasResolvedName = customerName.length > 0 && customerName !== "customer";

  return hasResolvedName || !!session.customerEmail?.trim();
}

function hydrateLivechatSession(
  session: LivechatSession,
  mapping: Awaited<ReturnType<typeof getIntercomThreadByDiscordThreadId>>,
): void {
  if (!mapping) {
    return;
  }

  session.customerName = mapping.customer_name ?? session.customerName;
  session.customerEmail = mapping.customer_email ?? session.customerEmail;
  session.intercomConversationId = mapping.intercom_conversation_id ?? session.intercomConversationId;
}

function buildCustomerAuthorLabel(session: LivechatSession, fallbackAuthor: string | null): string {
  const customerName = session.customerName?.trim();
  const customerEmail = session.customerEmail?.trim();
  const hasResolvedName = !!customerName && customerName.toLowerCase() !== "customer";

  if (customerEmail && hasResolvedName) {
    return `${customerName} (${customerEmail})`;
  }

  if (customerEmail) {
    return `Visitor (${customerEmail})`;
  }

  if (hasResolvedName) {
    return customerName;
  }

  if (fallbackAuthor?.trim()) {
    return fallbackAuthor.trim();
  }

  return "Customer";
}

function shouldAlert(extraction: LivechatExtraction): boolean {
  return (extraction.sentiment === "angry" || extraction.sentiment === "frustrated")
    && extraction.resolution !== "resolved";
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function markProcessed(messageIds: string[]): void {
  for (const messageId of messageIds) {
    processedMessageIds.add(messageId);
    if (processedMessageIds.size > MAX_PROCESSED_IDS) {
      const oldest = processedMessageIds.values().next().value;
      if (oldest) processedMessageIds.delete(oldest);
    }
  }
}

async function safeReact(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch {
    // Ignore reaction failures.
  }
}
