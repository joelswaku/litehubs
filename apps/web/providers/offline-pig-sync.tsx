"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getActiveOrganizationSlug } from "@/lib/api";
import { syncOfflinePigRecords } from "@/lib/offline-pig-records";

/** Synchronizes field entries as soon as a phone regains a connection. */
export function OfflinePigSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let running = false;
    const synchronize = async () => {
      if (running || typeof navigator === "undefined" || !navigator.onLine) return;
      const orgSlug = getActiveOrganizationSlug();
      if (!orgSlug) return;
      running = true;
      try {
        const result = await syncOfflinePigRecords(orgSlug);
        if (result.synced > 0) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["pigs"] }),
            queryClient.invalidateQueries({ queryKey: ["pig-overview", orgSlug] }),
          ]);
          toast.success(
            result.synced === 1
              ? "Saisie porcine synchronisée"
              : `${result.synced} saisies porcines synchronisées`,
          );
        }
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => void synchronize(), 30_000);
    window.addEventListener("online", synchronize);
    void synchronize();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", synchronize);
    };
  }, [queryClient]);

  return null;
}
