import type { Metadata } from "next";
import { WorkspaceShell } from "./workspace-shell";

// A workspace may contain private customer, HR, finance, and operational data.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every workspace page lives under `/{orgSlug}/…`, matching the API's own
 * `/organizations/:orgSlug/…` routes and structure.md's URL design — slugs, not
 * uuids, so a link reads as `/congo-omega/dashboard`.
 *
 * The shell is a client component because the sidebar it renders depends on the
 * caller's permissions, which come from the session, which lives in httpOnly
 * cookies the API reads. Server-rendering it would mean forwarding cookies and
 * duplicating the permission logic on both sides.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return <WorkspaceShell orgSlug={orgSlug}>{children}</WorkspaceShell>;
}
