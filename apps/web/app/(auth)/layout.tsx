import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";

// Sign-in, invitation, and password routes must never become search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthFrame>{children}</AuthFrame>;
}