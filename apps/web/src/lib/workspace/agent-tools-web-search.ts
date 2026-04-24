import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { createFirecrawlClient } from "@basquio/research";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";

const WEB_SEARCH_SOFT_WARN = 10;
const WEB_SEARCH_HARD_CAP = 200;

const webSearchInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(400)
    .describe("The search query. Natural language or Firecrawl operators like site:nielseniq.com."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Number of results to scrape. Default 5, keep low to stay under budget."),
  recency: z.enum(["anytime", "past_year", "past_month", "past_week"]).default("anytime"),
  source_type: z.enum(["web", "news"]).default("web"),
  country: z.string().length(2).default("IT").describe("ISO country for search localization."),
  language: z.string().length(2).default("it").describe("ISO language for the query context."),
});

export function webSearchTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Search the live web for information NOT in the workspace. Returns scraped article content, not just links. Use when the user asks a market-research, trend, competitor, or any question that requires current external knowledge. Search operators supported: site:, -site:, intitle:, \"exact phrase\". Italian market results by default. Before calling, always check listConversationFiles and retrieveContext first, because the answer may already be in the workspace.",
    inputSchema: webSearchInputSchema,
    execute: async (input) => {
      const conversationId = ctx.conversationId ?? "no-conversation";
      const currentCount = await countConversationSearches(conversationId);
      if (currentCount >= WEB_SEARCH_HARD_CAP) {
        return {
          error: `This conversation has reached the web search cap (${WEB_SEARCH_HARD_CAP}). Start a new conversation to continue searching.`,
        };
      }

      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) {
        return {
          error: "Web search failed: FIRECRAWL_API_KEY is not configured. Try workspace context with retrieveContext.",
        };
      }

      try {
        const firecrawl = createFirecrawlClient({ apiKey });
        const response = await firecrawl.search({
          query: input.language === "it" ? `${input.query} mercato Italia` : input.query,
          limit: input.max_results,
          sources: [input.source_type],
          country: input.country,
          tbs: recencyToTbs(input.recency),
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
        });
        const resultCount = response.data.length;
        const creditsUsed = response.creditsUsed ?? resultCount;
        await logWebSearchCall({
          conversationId,
          userId: ctx.userId,
          query: input.query,
          resultCount,
          creditsUsed,
        });

        return {
          budget_remaining: WEB_SEARCH_HARD_CAP - currentCount - 1,
          warning:
            currentCount + 1 >= WEB_SEARCH_SOFT_WARN
              ? `Approaching web search cap (${currentCount + 1}/${WEB_SEARCH_HARD_CAP}). Summarize findings efficiently.`
              : null,
          credits_used: creditsUsed,
          results: response.data.map((result) => {
            const metadata = result.data?.metadata ?? {};
            return {
              url: result.url,
              title: result.title ?? stringMetadata(metadata, "title"),
              published_at: publishedAt(metadata),
              markdown: (result.data?.markdown ?? "").slice(0, 15_000),
            };
          }),
        };
      } catch (error) {
        return {
          error: `Web search failed: ${error instanceof Error ? error.message : "unknown error"}. Try rephrasing the query or check workspace context with retrieveContext.`,
        };
      }
    },
  });
}

export async function countConversationSearches(conversationId: string): Promise<number> {
  const db = getDb();
  const { count, error } = await db
    .from("chat_web_search_calls")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if (error) return 0;
  return count ?? 0;
}

export async function logWebSearchCall(input: {
  conversationId: string;
  userId: string;
  query: string;
  resultCount: number;
  creditsUsed: number;
}): Promise<void> {
  const db = getDb();
  const { error } = await db.from("chat_web_search_calls").insert({
    conversation_id: input.conversationId,
    user_id: input.userId,
    query: input.query,
    result_count: input.resultCount,
    credits_used: input.creditsUsed,
  });
  if (error) {
    console.error("[workspace/webSearch] failed to log search call", error);
  }
}

export function recencyToTbs(recency: z.infer<typeof webSearchInputSchema>["recency"]): string | undefined {
  switch (recency) {
    case "past_year":
      return "qdr:y";
    case "past_month":
      return "qdr:m";
    case "past_week":
      return "qdr:w";
    case "anytime":
    default:
      return undefined;
  }
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function publishedAt(metadata: Record<string, unknown>): string | null {
  return (
    stringMetadata(metadata, "article:modified_time") ??
    stringMetadata(metadata, "article:published_time") ??
    stringMetadata(metadata, "parsely-pub-date") ??
    stringMetadata(metadata, "published_at") ??
    stringMetadata(metadata, "date") ??
    null
  );
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
