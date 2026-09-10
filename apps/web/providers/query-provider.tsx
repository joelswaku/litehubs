"use client";

import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  QueryCache,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, setSessionExpiredHandler } from "@/lib/api";
import { STALE_TIME } from "@/lib/constants";

/**
 * React Query, configured once.
 *
 * Two decisions carry most of the weight here.
 *
 * **Retries skip 4xx.** The default retries everything three times, which for a
 * 403 means hammering an endpoint that will never say yes, and for a 422 means
 * resubmitting invalid input. Only 5xx and network failures are worth retrying.
 *
 * **Errors surface once, centrally.** A failed mutation shows a toast from the
 * cache callback rather than from each `onError`, so no mutation can forget to
 * report a failure silently. Queries stay quiet — a widget that fails to load
 * renders its own empty state, and five toasts for five widgets is noise.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Created in state so the client survives re-renders but is per-request on the
  // server — a module-level client would leak one user's cache into another's.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE_TIME.standard,
            gcTime: 5 * 60_000,
            retry: (failureCount, error) => {
              if (error instanceof ApiError) {
                // Client errors are answers, not failures. Retrying a 401 in
                // particular would fight the refresh interceptor.
                if (error.status >= 400 && error.status < 500) return false;
              }
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
            refetchOnWindowFocus: true,
            // Refetching on reconnect matters here: staff work on phones with
            // patchy signal inside farm buildings.
            refetchOnReconnect: true,
          },
          mutations: {
            retry: false,
          },
        },

        queryCache: new QueryCache({
          onError: (error) => {
            // Only report the case the user can act on; leave the rest to the
            // component's own empty state.
            if (error instanceof ApiError && error.status === 0) {
              toast.error("No connection", {
                description: "Your changes are not saved. Reconnecting…",
                id: "offline",
              });
            }
          },
        }),

        mutationCache: new MutationCache({
          onError: (error) => {
            if (!(error instanceof ApiError)) {
              toast.error("Something went wrong");
              return;
            }

            // 401 is handled by the api client's refresh-and-retry; by the time
            // it reaches here the session is genuinely gone and the redirect is
            // already in flight, so a toast would just add noise.
            if (error.isUnauthorized) return;

            if (error.isForbidden) {
              toast.error("Not allowed", { description: error.message });
              return;
            }

            if (error.status === 422) {
              // Keep the global feedback actionable even on a form that has not
              // yet wired a field-error state. Individual forms can still show
              // the same error beside the input.
              const [field, messages] = Object.entries(error.fieldErrors)[0] ?? [];
              const fieldLabel = field
                ? field
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .replace(/\./g, " › ")
                : "the form";
              toast.error(`Check ${fieldLabel}`, {
                description: messages?.[0] ?? error.message,
              });
              return;
            }

            toast.error(error.message);
          },
        }),
      }),
  );

  useState(() => {
    // Wired once. When refreshing fails there is no session left to salvage, so
    // the cache is dropped and the user sent to log in with a full page load —
    // a client-side push would keep stale data on screen behind the form.
    setSessionExpiredHandler(() => {
      queryClient.clear();
      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname;
        const platformRoute =
          currentPath === "/platform" || currentPath.startsWith("/platform/");
        const signInPath = platformRoute ? "/staff" : "/login";

        // Do not redirect an authentication form back onto itself.
        if (currentPath === signInPath) return;

        const next = encodeURIComponent(currentPath + window.location.search);
        window.location.href = `${signInPath}?next=${next}`;
      }
    });
  });

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
