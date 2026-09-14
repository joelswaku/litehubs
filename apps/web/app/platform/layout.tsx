import type { Metadata } from "next";
import { PlatformShell } from "./platform-shell";

// Platform administration contains tenant and support data.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformShell>{children}</PlatformShell>;
}