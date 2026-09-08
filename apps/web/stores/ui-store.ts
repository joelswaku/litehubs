"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Client state: what the interface looks like right now.
 *
 * The split from React Query is deliberate and worth stating, because mixing
 * the two is the usual mistake. React Query owns anything the *server* is the
 * source of truth for — alerts, employees, flocks. Zustand owns anything the
 * *browser* is the source of truth for, which is this file. Nothing here is
 * ever fetched, and nothing fetched is ever stored here.
 *
 * Persisted so a collapsed sidebar stays collapsed across a reload. The theme is
 * handled by next-themes instead, which writes before first paint and so avoids
 * the flash of the wrong theme that a persisted store here would cause.
 */

interface UiState {
  /** Desktop sidebar collapsed to icons only. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** Mobile drawer. Not persisted — it must never be open on load. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  /** ⌘K palette. */
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;

  /** Nav groups the user has folded away, by group id. */
  collapsedGroups: string[];
  toggleGroup: (id: string) => void;

  /**
   * Whether charts render with a texture fill as well as colour. Turned on for
   * colour-vision accessibility and for printing, where hue alone is not enough.
   */
  chartTexture: boolean;
  setChartTexture: (enabled: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleCommand: () =>
        set((state) => ({ commandOpen: !state.commandOpen })),

      collapsedGroups: [],
      toggleGroup: (id) =>
        set((state) => ({
          collapsedGroups: state.collapsedGroups.includes(id)
            ? state.collapsedGroups.filter((value) => value !== id)
            : [...state.collapsedGroups, id],
        })),

      chartTexture: false,
      setChartTexture: (chartTexture) => set({ chartTexture }),
    }),
    {
      name: "litehubs-ui",
      // Only the durable preferences. Persisting an open drawer or palette would
      // restore them on next load, which is never what the user meant.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedGroups: state.collapsedGroups,
        chartTexture: state.chartTexture,
      }),
    },
  ),
);
