import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/seo";

/** Only LiteHubs-owned public marketing pages are listed here. Customer
 * workspaces and private operational routes are intentionally excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: publicUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: publicUrl("/contact"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: publicUrl("/rendezvous"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];
}
