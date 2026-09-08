"use client";

import { create } from "zustand";
import type { SessionUser } from "@/lib/auth";

/**
 * The signed-in user, held so that synchronous code can read it.
 *
 * React Query already owns fetching and caching the session — this store is not
 * a second copy of that. It exists because permission checks happen during
 * render, in dozens of places, and `can(user, ...)` needs the user *now*, not a
 * promise. The query is the source of truth and writes here on every change;
 * nothing else writes.
 *
 * Deliberately **not persisted.** A stale session in localStorage would let the
 * interface show a workspace the user has since been removed from, and would
 * survive a logout. The cookies are the session; this is a render-time mirror.
 */

interface SessionState {
  user: SessionUser | null;
  /** False until the first /auth/me settles, so the shell can hold its layout. */
  isResolved: boolean;

  setUser: (user: SessionUser | null) => void;
  setResolved: (resolved: boolean) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  user: null,
  isResolved: false,

  setUser: (user) => set({ user, isResolved: true }),
  setResolved: (isResolved) => set({ isResolved }),
  clear: () => set({ user: null, isResolved: true }),
}));

/* ---------------------------------------------------------------- selectors -- */
/* Selectors rather than reading the whole store, so a component re-renders only
   when the slice it uses changes. Reading `useSessionStore()` bare would
   re-render every consumer on any session change.                             */

export const useSessionUser = () => useSessionStore((state) => state.user);

export const useSessionResolved = () =>
  useSessionStore((state) => state.isResolved);

export const useActiveOrganization = () =>
  useSessionStore((state) => state.user?.activeOrganization ?? null);

export const usePermissions = () =>
  useSessionStore((state) => state.user?.permissions ?? EMPTY);

export const useIsPlatformStaff = () =>
  useSessionStore((state) => state.user?.isPlatformStaff ?? false);

/** One frozen array, so the selector returns a stable reference and does not
 *  trigger a re-render on every call by handing back a fresh []. */
const EMPTY: readonly string[] = Object.freeze([]);
