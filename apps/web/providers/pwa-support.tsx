"use client";

import { useEffect } from "react";

/**
 * Registers the application shell and exposes the browser's native install
 * action when available. It never stores private workspace pages in the
 * service-worker cache; the field queue is separate and tenant-scoped.
 */
export function PwaSupport() {
  // Phones: iOS keeps 100dvh at full height when the keyboard opens, so the
  // message box ends up behind it. Expose the visible height as --vvh so
  // full-height screens (chat) shrink above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--vvh", `${Math.round(viewport.height)}px`);
      const open = window.innerHeight - viewport.height > 120;
      if (open) {
        root.dataset.keyboard = "open";
        // Keep the field being typed in just above the keyboard.
        const field = document.activeElement;
        if (field instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(field.tagName))
          window.requestAnimationFrame(() => field.scrollIntoView({ block: "nearest" }));
      } else delete root.dataset.keyboard;
    };
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      root.style.removeProperty("--vvh");
      delete root.dataset.keyboard;
    };
  }, []);

  useEffect(() => {
    // Next development bundles use stable URLs. A cache-first service worker
    // would therefore keep an older workspace screen after a normal refresh,
    // until the person discovers Ctrl+F5. Development must always use the
    // server's newest bundle; production keeps the offline application shell.
    if (process.env.NODE_ENV !== "production") {
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(registrations.map((registration) => registration.unregister())),
          );
      }
      if ("caches" in window) {
        void caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("litehubs-"))
              .map((key) => caches.delete(key)),
          ),
        );
      }
      return;
    }
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {
          // Installing LiteHubs is optional. The browser remains fully usable if
          // a managed device disables service workers.
        });
    }
  }, []);

  // Installation remains available through the browser's native install
  // control. The workspace deliberately shows no floating install promotion.
  return null;
}
