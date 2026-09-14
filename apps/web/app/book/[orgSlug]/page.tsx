import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Book an appointment",
  description: "Request an appointment with a LiteHubs organization.",
};

/** Legacy direct links stay valid but now use the single slot-aware booking flow. */
export default async function Page({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ site?: string | string[] }> }) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const site = Array.isArray(query.site) ? query.site[0] : query.site;
  const suffix = site ? `?org=${encodeURIComponent(orgSlug)}&site=${encodeURIComponent(site)}` : `?org=${encodeURIComponent(orgSlug)}`;
  redirect(`/rendezvous${suffix}`);
}