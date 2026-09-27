"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useSessionUser } from "@/stores/session-store";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/**
 * Registers the application shell and exposes the browser's native install
 * action when available. It never stores private workspace pages in the
 * service-worker cache; the field queue is separate and tenant-scoped.
 */
export function PwaSupport() {
  const user = useSessionUser();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Chromium may emit the install event before a user completes sign-in.
    // Listen immediately so the invitation is not lost, but do not render the
    // action until a LiteHubs session exists below.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {
          // Installing LiteHubs is optional. The browser remains fully usable if
          // a managed device disables service workers.
        });
    }
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Chrome keeps the originating browser tab open after installation, while
    // the installed app runs in standalone display mode. Handle both places so
    // the install control never lingers after a successful installation.
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateInstalledState = () => {
      const navigatorWithStandalone = navigator as Navigator & {
        standalone?: boolean;
      };
      setIsInstalled(
        displayMode.matches || navigatorWithStandalone.standalone === true,
      );
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    updateInstalledState();
    displayMode.addEventListener("change", updateInstalledState);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      displayMode.removeEventListener("change", updateInstalledState);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!user || isInstalled) return null;
  return (
    <button
      type="button"
      className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-xl border border-brand/30 bg-surface-1 px-3 py-2 text-sm font-semibold text-ink shadow-xl shadow-black/15 transition hover:-translate-y-px hover:border-brand/55 hover:bg-brand-subtle dark:border-brand/40 dark:bg-surface-1"
      onClick={async () => {
        if (!installPrompt) {
          toast.info("Installer LiteHubs", {
            description: "Dans Chrome : ouvrez le menu ⋮ puis choisissez « Installer LiteHubs » ou l’icône d’installation à droite de la barre d’adresse.",
          });
          return;
        }
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome !== "dismissed") {
          // appinstalled normally follows immediately; this also hides the
          // control in the originating browser tab without waiting for it.
          setIsInstalled(true);
          setInstallPrompt(null);
        }
      }}
    >
      <Download className="size-4 text-brand" />
      Installer LiteHubs
    </button>
  );
}
