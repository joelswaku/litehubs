"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * GA4 is deliberately mounted only on public marketing routes. Workspace URLs
 * can contain a customer slug and operational views can include sensitive HR,
 * finance, health, or production data, so they must never be measured here.
 */
const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-1SRBXY14XJ";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackMarketingEvent(name: string, parameters: Record<string, string | number | boolean> = {}) {
  if (typeof window === "undefined") return;
  // Callers must pass aggregate labels only. Never include a name, email,
  // phone number, company identifier, message, application, or workspace URL.
  if (window.gtag) { window.gtag("event", name, parameters); return; }
  // Events fired during hydration are queued until the GA script is ready.
  (window.dataLayer ??= []).push(["event", name, parameters]);
}

export function PublicMarketingAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    trackMarketingEvent("page_view", {
      page_path: pathname,
      page_title: document.title,
    });
  }, [pathname]);

  return <>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
    <Script id="litehubs-ga4" strategy="afterInteractive">{`
      window.dataLayer = window.dataLayer || [];
      function gtag(){window.dataLayer.push(arguments);}
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', '${measurementId}', {
        send_page_view: false,
        anonymize_ip: true,
        allow_google_signals: false
      });
    `}</Script>
  </>;
}
