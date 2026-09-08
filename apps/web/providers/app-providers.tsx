"use client";

import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { LanguageProvider } from "./language-provider";
import { QueryProvider } from "./query-provider";

/** Shared browser providers. Language sits outside the UI so every screen,
 * including login, navigation and dashboards, uses the same preference. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <LanguageProvider>
        <NuqsAdapter>
          <QueryProvider>
            {children}
            <Toaster
              position="bottom-right"
              theme="system"
              closeButton
              richColors
              duration={5000}
              toastOptions={{
                classNames: {
                  toast:
                    "bg-surface-1 text-ink border border-border shadow-lg rounded-lg",
                  description: "text-ink-secondary",
                },
              }}
            />
          </QueryProvider>
        </NuqsAdapter>
      </LanguageProvider>
    </ThemeProvider>
  );
}
