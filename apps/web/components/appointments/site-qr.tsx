"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import QRCode from "qrcode";

/** Generates locally in the browser: the signed QR URL is never sent to a third party. */
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function SiteQr({ value, label, printTitle, printLabel }: { value: string; label: string; printTitle?: string; printLabel?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    void QRCode.toDataURL(value, {
      width: 768,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#073b32", light: "#ffffff" },
    }).then(setSrc);
  }, [value]);

  const print = () => {
    if (!src) return;
    const popup = window.open("", "_blank", "popup,width=800,height=1000");
    if (!popup) return;
    popup.opener = null;
    const title = escapeHtml(printTitle ?? label);
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#073b32;text-align:center}main{display:grid;min-height:250mm;place-items:center}section{max-width:150mm}h1{font-size:26px;margin:0 0 10px}p{font-size:15px;line-height:1.55;color:#35534d;margin:0 0 22px}img{width:122mm;height:122mm;image-rendering:auto}small{display:block;margin-top:20px;color:#5c746e}</style></head><body><main><section><h1>${title}</h1><p>Scannez ce code avec votre téléphone pour vous enregistrer, expliquer le motif de votre visite et recevoir votre numéro de file.</p><img src="${src}" alt="${title}"><small>LiteHubs · arrivée et file d’attente sécurisées</small></section></main><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  };

  return src ? <figure className="inline-flex flex-col items-start gap-2"><img src={src} width={136} height={136} className="rounded-xl border border-border bg-white p-1 shadow-sm" alt={label} /><button type="button" onClick={print} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"><Printer className="size-3.5" />{printLabel ?? "Print QR"}</button></figure> : <div className="size-[136px] animate-pulse rounded-xl bg-surface-3" aria-label={label} />;
}