"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  fetchSession,
  landingPathFor,
  workspaceLandingPathFor,
  login as loginRequest,
  logout as logoutRequest,
  switchOrganization as switchRequest,
  type SessionUser,
} from "@/lib/auth";
import { ApiError, setActiveOrganizationSlug } from "@/lib/api";
import { STALE_TIME } from "@/lib/constants";
import { useSessionStore } from "@/stores/session-store";

export const sessionKey = ["session"] as const;

/**
 * Loads the session and mirrors it into the zustand store.
 *
 * The mirroring is the point: permission checks run synchronously during render
 * all over the app, so they need the user as a value rather than as a query
 * result. React Query stays the source of truth for fetching; the store is a
 * read-optimised copy of whatever it last returned.
 *
 * Mount this once, in the layout. Calling it in several places is harmless —
 * they share one query — but the store write only needs to happen once.
 */
export function useSession() {
  const setUser = useSessionStore((state) => state.setUser);

  const query = useQuery({
    queryKey: sessionKey,
    queryFn: fetchSession,
    staleTime: STALE_TIME.standard,
    // A 401 here means "not signed in", which is an answer, not an error worth
    // retrying — the api client has already tried refreshing by this point.
    retry: false,
  });

  useEffect(() => {
    if (query.isSuccess) setUser(query.data);
    // A failed session read means no session. Recording that resolves the
    // loading state, so the shell stops waiting and the guard can redirect.
    if (query.isError) setUser(null);
  }, [query.isSuccess, query.isError, query.data, setUser]);

  return query;
}

export function useLogin(nextPath?: string | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      loginRequest(email, password),

    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(sessionKey, user);

      if (user.activeOrganization) {
        setActiveOrganizationSlug(user.activeOrganization.slug);
      }

      const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
        ? nextPath
        : null;
      router.replace(safeNext ?? workspaceLandingPathFor(user));
    },

    onError: (error) => {
      // Login failures are shown on the form itself, so the shared mutation
      // toast would double up. Only the locked-account case needs shouting
      // about, because it is time-based and the user must know to wait.
      if (error instanceof ApiError && error.status === 423) {
        toast.error("Account temporarily locked", {
          description: error.message,
        });
      }
    },
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const clear = useSessionStore((state) => state.clear);

  return useMutation({
    mutationFn: logoutRequest,
    // Runs whether or not the request succeeded. If the server call fails the
    // cookies may survive, but leaving a user staring at a dashboard they asked
    // to leave is worse — the next request will 401 and redirect anyway.
    onSettled: () => {
      clear();
      setActiveOrganizationSlug(null);
      queryClient.clear();
      router.replace("/login");
    },
  });
}

export function useSwitchOrganization() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);

  return useMutation({
    mutationFn: (organizationSlug: string) => switchRequest(organizationSlug),

    onSuccess: (user: SessionUser) => {
      setUser(user);
      queryClient.setQueryData(sessionKey, user);

      const slug = user.activeOrganization?.slug ?? null;
      setActiveOrganizationSlug(slug);

      // Everything cached belongs to the workspace we just left. Removing
      // rather than invalidating means no stale row from the previous tenant
      // can flash on screen while the refetch is in flight.
      queryClient.removeQueries({
        predicate: (q) => q.queryKey !== sessionKey,
      });

      if (slug) router.push(`/${slug}/dashboard`);
    },
  });
}
