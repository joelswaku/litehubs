import type { MetadataRoute } from "next";
import { publicUrl, siteHost } from "@/lib/seo";

/**
 * Everything that is behind auth, tenant-scoped, or an operational entry point
 * a crawler has no business fetching. Shared by every group below.
 *
 * This list has to be repeated per group rather than stated once: a crawler
 * obeys exactly one group — the most specific `User-Agent` match — and ignores
 * all others. So naming `GPTBot` at all means `GPTBot` stops reading the `*`
 * group, and a named group without these lines would be an *invitation* to
 * crawl the dashboard rather than the permission to crawl the marketing pages
 * it was meant to be.
 */
const DISALLOW = [
  "/api/",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/register",
  "/staff",
  "/platform",
  "/select-organization",
  "/dashboard",
  "/book",
  "/check-in",
  "/queue",
];

/**
 * Assistant and answer-engine crawlers, listed explicitly so that allowing them
 * is a recorded decision rather than a side effect of the `*` fallback.
 *
 * Retrieval and training are separate things here. The search-time fetchers
 * (OAI-SearchBot, Claude-SearchBot, PerplexityBot, DuckAssistBot) are what
 * decide whether LiteHubs can be cited when someone asks an assistant about
 * farm management software, and `Google-Extended` governs AI Overviews and
 * Gemini grounding — it is not a web-search signal and denying it removes the
 * site from those answers without improving its ranking.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "DuckAssistBot",
  "meta-externalagent",
  "Amazonbot",
  "cohere-ai",
  "YouBot",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: DISALLOW },
    ],
    sitemap: publicUrl("/sitemap.xml"),
    host: siteHost,
  };
}
