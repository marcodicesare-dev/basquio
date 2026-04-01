import type { MetadataRoute } from "next";

const APP_ROUTES = ["/api/", "/auth/", "/dashboard", "/jobs/", "/artifacts", "/recipes", "/templates", "/settings", "/billing"];

/**
 * Robots.txt strategy: block training crawlers, allow retrieval/search crawlers.
 *
 * Training bots (GPTBot, Google-Extended, CCBot, anthropic-ai, Bytespider, meta-externalagent)
 * consume content for model training — blocking these protects IP without affecting visibility.
 *
 * Search/retrieval bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, etc.)
 * fetch content in real-time to answer user queries — allowing these is what drives AI visibility.
 *
 * Ref: Anthropic, OpenAI, Perplexity all distinguish training vs retrieval crawlers as of 2026.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default: allow search engines
      {
        userAgent: "*",
        allow: "/",
        disallow: APP_ROUTES,
      },

      // ── Training crawlers: BLOCK (protects IP, no visibility impact) ──
      {
        userAgent: "GPTBot",
        disallow: "/",
      },
      {
        userAgent: "Google-Extended",
        disallow: "/",
      },
      {
        userAgent: "CCBot",
        disallow: "/",
      },
      {
        userAgent: "anthropic-ai",
        disallow: "/",
      },
      {
        userAgent: "Bytespider",
        disallow: "/",
      },
      {
        userAgent: "meta-externalagent",
        disallow: "/",
      },
      {
        userAgent: "Ai2Bot",
        disallow: "/",
      },
      {
        userAgent: "Ai2Bot-Dolma",
        disallow: "/",
      },
      {
        userAgent: "Diffbot",
        disallow: "/",
      },

      // ── Search/retrieval crawlers: ALLOW (drives AI visibility) ──
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "ChatGPT-User",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "PerplexityBot",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "Perplexity-User",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "ClaudeBot",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "Claude-SearchBot",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "Claude-User",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "Gemini-Deep-Research",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "MistralAI-User",
        allow: "/",
        disallow: APP_ROUTES,
      },
      {
        userAgent: "DuckAssistBot",
        allow: "/",
        disallow: APP_ROUTES,
      },
    ],
    sitemap: "https://basquio.com/sitemap.xml",
  };
}
