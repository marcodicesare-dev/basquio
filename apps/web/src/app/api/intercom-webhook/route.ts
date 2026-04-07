import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const INTERCOM_API_VERSION = "2.13";
const CUSTOMER_AUTHOR_TYPES = new Set(["user", "lead", "contact"]);

interface IntercomAuthor {
  type?: string;
  id?: string | number;
  name?: string;
  email?: string;
}

interface IntercomConversationMessage {
  id?: string | number;
  body?: string;
  created_at?: number;
  author?: IntercomAuthor;
}

interface IntercomConversationPart {
  id?: string | number;
  body?: string;
  created_at?: number;
  author?: IntercomAuthor;
}

interface IntercomConversation {
  id?: string | number;
  state?: string;
  created_at?: number;
  updated_at?: number;
  source?: IntercomConversationMessage;
  conversation_message?: IntercomConversationMessage;
  conversation_parts?: {
    conversation_parts?: IntercomConversationPart[];
  };
}

interface IntercomWebhookPayload {
  topic?: string;
  data?: {
    item?: IntercomConversation;
  };
}

interface IntercomThreadRow {
  intercom_conversation_id: string;
  discord_thread_id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: string;
  last_customer_message_signature: string | null;
  metadata: Record<string, unknown> | null;
}

interface ResolvedCustomerMessage {
  body: string;
  author: IntercomAuthor;
  messageId: string | null;
  signature: string;
}

interface CustomerIdentity {
  name: string;
  email: string | null;
}

class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const intercomClientSecret = process.env.INTERCOM_CLIENT_SECRET;
  const discordBotToken = process.env.DISCORD_BOT_TOKEN;
  const livechatChannelId = process.env.DISCORD_LIVECHAT_CHANNEL_ID;

  if (!supabaseUrl || !serviceKey || !intercomClientSecret || !discordBotToken || !livechatChannelId) {
    return NextResponse.json({ error: "Intercom webhook configuration is incomplete." }, { status: 500 });
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get("x-hub-signature");

  if (!providedSignature || !verifyIntercomSignature(rawBody, intercomClientSecret, providedSignature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: IntercomWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as IntercomWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const topic = payload.topic;
  if (topic !== "conversation.user.created" && topic !== "conversation.user.replied") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const conversation = payload.data?.item;
  const conversationId = conversation?.id != null ? String(conversation.id) : null;
  if (!conversation || !conversationId) {
    return NextResponse.json({ error: "Missing conversation payload." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient(supabaseUrl, serviceKey);
  const { data: existingRow, error: fetchError } = await supabase
    .from("intercom_threads")
    .select(
      "intercom_conversation_id, discord_thread_id, customer_name, customer_email, status, last_customer_message_signature, metadata",
    )
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: `Failed to load thread mapping: ${fetchError.message}` }, { status: 500 });
  }

  const mapping = existingRow as IntercomThreadRow | null;
  const resolvedMessage = await resolveCustomerMessage({
    conversation,
    topic,
    intercomAccessToken: process.env.INTERCOM_ACCESS_TOKEN,
    intercomApiBaseUrl: process.env.INTERCOM_API_BASE_URL ?? "https://api.intercom.io",
  });

  if (!resolvedMessage) {
    return NextResponse.json({ ok: true, skipped: "No customer text found." });
  }

  if (mapping?.last_customer_message_signature === resolvedMessage.signature) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const customerIdentity = resolveCustomerIdentity(
    resolvedMessage.author.name,
    resolvedMessage.author.email,
    mapping,
  );
  const customerName = customerIdentity.name;
  const customerEmail = customerIdentity.email;
  const status = normalizeConversationStatus(conversation.state);

  let discordThreadId = mapping?.discord_thread_id ?? null;

  try {
    if (!discordThreadId) {
      discordThreadId = await createDiscordLivechatThread({
        discordBotToken,
        livechatChannelId,
        customerName,
        customerEmail,
        preview: resolvedMessage.body,
        conversationId,
      });
    }

    await postMessageToDiscordThread(discordBotToken, discordThreadId, resolvedMessage.body);
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) {
      discordThreadId = await createDiscordLivechatThread({
        discordBotToken,
        livechatChannelId,
        customerName,
        customerEmail,
        preview: resolvedMessage.body,
        conversationId,
      });
      await postMessageToDiscordThread(discordBotToken, discordThreadId, resolvedMessage.body);
    } else {
      const message = error instanceof Error ? error.message : "Discord delivery failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { error: upsertError } = await supabase
    .from("intercom_threads")
    .upsert(
      {
        intercom_conversation_id: conversationId,
        discord_thread_id: discordThreadId,
        customer_name: customerName,
        customer_email: customerEmail,
        status,
        last_customer_message_signature: resolvedMessage.signature,
        metadata: {
          last_intercom_message_id: resolvedMessage.messageId,
          last_webhook_topic: topic,
          last_customer_body_preview: resolvedMessage.body.slice(0, 280),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "intercom_conversation_id" },
    );

  if (upsertError) {
    return NextResponse.json({ error: `Failed to persist thread mapping: ${upsertError.message}` }, { status: 500 });
  }

  if (
    discordThreadId
    && mapping
    && (customerName !== mapping.customer_name || customerEmail !== mapping.customer_email)
  ) {
    await discordRequest(
      `/channels/${discordThreadId}`,
      discordBotToken,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: buildThreadName(customerName, customerEmail, resolvedMessage.body),
        }),
      },
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, conversationId, discordThreadId });
}

function verifyIntercomSignature(
  rawBody: string,
  clientSecret: string,
  providedSignature: string,
): boolean {
  const expected = `sha1=${createHmac("sha1", clientSecret).update(rawBody).digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

async function resolveCustomerMessage(input: {
  conversation: IntercomConversation;
  topic: string;
  intercomAccessToken?: string;
  intercomApiBaseUrl: string;
}): Promise<ResolvedCustomerMessage | null> {
  if (input.topic === "conversation.user.replied" && input.intercomAccessToken && input.conversation.id != null) {
    const fetchedConversation = await fetchIntercomConversation(
      String(input.conversation.id),
      input.intercomAccessToken,
      input.intercomApiBaseUrl,
    ).catch(() => null);

    const fetchedMessage = fetchedConversation
      ? extractCustomerMessage(fetchedConversation, input.topic)
      : null;

    if (fetchedMessage) {
      return fetchedMessage;
    }
  }

  return extractCustomerMessage(input.conversation, input.topic);
}

async function fetchIntercomConversation(
  conversationId: string,
  accessToken: string,
  apiBaseUrl: string,
): Promise<IntercomConversation> {
  const response = await fetch(`${apiBaseUrl}/conversations/${conversationId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Intercom-Version": INTERCOM_API_VERSION,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Intercom conversation fetch failed with ${response.status}.`);
  }

  return (await response.json()) as IntercomConversation;
}

function extractCustomerMessage(
  conversation: IntercomConversation,
  topic: string,
): ResolvedCustomerMessage | null {
  const candidates: Array<{
    body: string;
    author: IntercomAuthor;
    messageId: string | null;
    createdAt: number;
  }> = [];

  const initialCandidates = [conversation.conversation_message, conversation.source];
  for (const candidate of initialCandidates) {
    if (candidate?.body && isCustomerAuthor(candidate.author)) {
      candidates.push({
        body: candidate.body,
        author: candidate.author ?? {},
        messageId: candidate.id != null ? String(candidate.id) : null,
        createdAt: candidate.created_at ?? conversation.created_at ?? 0,
      });
    }
  }

  for (const part of conversation.conversation_parts?.conversation_parts ?? []) {
    if (!part.body || !isCustomerAuthor(part.author)) {
      continue;
    }

    candidates.push({
      body: part.body,
      author: part.author ?? {},
      messageId: part.id != null ? String(part.id) : null,
      createdAt: part.created_at ?? conversation.updated_at ?? conversation.created_at ?? 0,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const selected = [...candidates].sort((left, right) => {
    if (topic === "conversation.user.created") {
      return left.createdAt - right.createdAt;
    }
    return right.createdAt - left.createdAt;
  })[0];

  if (!selected) {
    return null;
  }

  const normalizedBody = normalizeIntercomBody(selected.body);
  if (!normalizedBody) {
    return null;
  }

  return {
    body: normalizedBody,
    author: selected.author,
    messageId: selected.messageId,
    signature: buildMessageSignature({
      topic,
      messageId: selected.messageId,
      body: normalizedBody,
      timestamp: selected.createdAt || conversation.updated_at || conversation.created_at || 0,
    }),
  };
}

function isCustomerAuthor(author: IntercomAuthor | undefined): boolean {
  return !!author?.type && CUSTOMER_AUTHOR_TYPES.has(author.type);
}

function normalizeIntercomBody(body: string): string {
  const withLineBreaks = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ");

  const stripped = withLineBreaks.replace(/<[^>]*>/g, "");
  const decoded = decodeHtmlEntities(stripped)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decoded || "[Customer sent a non-text Intercom message]";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

function buildMessageSignature(input: {
  topic: string;
  messageId: string | null;
  body: string;
  timestamp: number;
}): string {
  if (input.messageId) {
    return `message:${input.messageId}`;
  }

  return `${input.topic}:${input.timestamp}:${input.body}`;
}

async function createDiscordLivechatThread(input: {
  discordBotToken: string;
  livechatChannelId: string;
  customerName: string;
  customerEmail: string | null;
  preview: string;
  conversationId: string;
}): Promise<string> {
  const starterMessage = await discordRequest<{ id: string }>(
    `/channels/${input.livechatChannelId}/messages`,
    input.discordBotToken,
    {
      method: "POST",
      body: JSON.stringify({
        content: buildStarterMessage(input.customerName, input.customerEmail, input.conversationId),
        allowed_mentions: { parse: [] },
      }),
    },
  );

  const thread = await discordRequest<{ id: string }>(
    `/channels/${input.livechatChannelId}/messages/${starterMessage.id}/threads`,
    input.discordBotToken,
    {
      method: "POST",
      body: JSON.stringify({
        name: buildThreadName(input.customerName, input.customerEmail, input.preview),
        auto_archive_duration: 10080,
      }),
    },
  );

  return thread.id;
}

async function postMessageToDiscordThread(
  discordBotToken: string,
  threadId: string,
  body: string,
): Promise<void> {
  const formattedBody = formatCustomerRelay(body);

  for (const chunk of splitDiscordMessage(formattedBody)) {
    await discordRequest(
      `/channels/${threadId}/messages`,
      discordBotToken,
      {
        method: "POST",
        body: JSON.stringify({
          content: chunk,
          allowed_mentions: { parse: [] },
        }),
      },
    );
  }
}

async function discordRequest<T = Record<string, unknown>>(
  path: string,
  botToken: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new DiscordApiError(response.status, `Discord API ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

function buildStarterMessage(
  customerName: string,
  customerEmail: string | null,
  conversationId: string,
): string {
  const identityLine = customerEmail
    ? `From **${customerName}** (${customerEmail})`
    : `From **${customerName}**`;

  return [
    "📩 **New live chat**",
    identityLine,
    `Intercom conversation \`${conversationId}\``,
    "---",
    "Reply naturally in this thread. Basquio Bot will send your message to the customer and keep the team loop tight.",
  ].join("\n");
}

function buildThreadName(customerName: string, customerEmail: string | null, preview: string): string {
  const compactPreview = preview.replace(/\s+/g, " ").trim().slice(0, 60);
  const participantLabel = buildThreadParticipantLabel(customerName, customerEmail);
  const base = `${participantLabel} — ${compactPreview || "Live chat"}`;
  return base.slice(0, 100);
}

function resolveCustomerIdentity(
  nextName: string | undefined,
  nextEmail: string | undefined,
  mapping: IntercomThreadRow | null,
): CustomerIdentity {
  const name = nextName?.trim() || mapping?.customer_name?.trim() || "Customer";
  const email = nextEmail?.trim() || mapping?.customer_email?.trim() || null;

  if (isGenericCustomerName(name) && email) {
    return { name: "Visitor", email };
  }

  return {
    name: name || "Visitor",
    email,
  };
}

function buildThreadParticipantLabel(customerName: string, customerEmail: string | null): string {
  if (customerEmail) {
    return `${customerName} (${customerEmail})`;
  }

  return isGenericCustomerName(customerName) ? "Visitor" : customerName;
}

function isGenericCustomerName(customerName: string): boolean {
  const normalized = customerName.trim().toLowerCase();
  return normalized.length === 0 || normalized === "customer" || normalized === "visitor";
}

function formatCustomerRelay(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trim().length === 0 ? ">" : `> ${line}`)
    .join("\n");
}

function splitDiscordMessage(content: string): string[] {
  if (content.length <= 2000) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 2000) {
    let splitAt = remaining.lastIndexOf("\n", 2000);
    if (splitAt === -1 || splitAt < 1200) {
      splitAt = 2000;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function normalizeConversationStatus(status: string | undefined): string {
  return status?.trim() || "open";
}
