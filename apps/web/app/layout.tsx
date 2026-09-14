import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/providers/app-providers";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://litehubs.com";

/**
 * Search Console's HTML-tag verification method. Optional: DNS verification
 * needs nothing here, and an unset value simply omits the tag rather than
 * emitting an empty one, which Search Console reads as a failed check.
 */
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: APP_NAME,
    // Applies to child segments only — never to `app/page.tsx`, which shares
    // this segment and therefore sets its own absolute title.
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Gestion des opérations pour les entreprises agricoles modernes.",
  applicationName: APP_NAME,
  manifest: "/site.webmanifest",
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // A workspace URL contains a customer's slug, and the dashboard is behind
  // auth, so there is nothing here for a crawler to index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Supervisors fill records on phones; the browser chrome should match the
  // active theme rather than sitting as a white bar above a dark app.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required by next-themes: it sets the theme
    // class on <html> before React hydrates, so server and client markup
    // legitimately differ on this one element. Without it every load logs a
    // hydration warning; the alternative is a flash of the wrong theme.
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-dvh bg-page text-ink antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
