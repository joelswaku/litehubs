"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getActiveOrganizationSlug } from "@/lib/api";
import { syncOfflinePoultryRecords } from "@/lib/offline-poultry-records";

/** Keeps locally saved field records moving as soon as the phone reconnects. */
export function OfflinePoultrySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let running = false;
    const synchronize = async () => {
      if (running || typeof navigator === "undefined" || !navigator.onLine) return;
      const orgSlug = getActiveOrganizationSlug();
      if (!orgSlug) return;
      running = true;
      try {
        const result = await syncOfflinePoultryRecords(orgSlug);
        if (result.synced > 0) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["poultry"] }),
            queryClient.invalidateQueries({ queryKey: ["poultry-record-centre", orgSlug] }),
            queryClient.invalidateQueries({ queryKey: ["poultry-overview", orgSlug] }),
            queryClient.invalidateQueries({ queryKey: ["poultry-performance", orgSlug] }),
          ]);
          toast.success(
            result.synced === 1
              ? "Saisie terrain synchronisée"
              : `${result.synced} saisies terrain synchronisées`,
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