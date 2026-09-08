"use client";
import { Download, FileText } from "lucide-react";
import { orgApiUrl } from "@/lib/api";
export function HrPdfButton({ orgSlug, report, fr, employeeId, className = "", label: buttonLabel }: { orgSlug:string; report:"employee"|"attendance"|"leave"|"payroll"|"performance"|"discipline"; fr:boolean; employeeId?:string; className?:string; label?: string }) {
  const query = new URLSearchParams({ lang: fr ? "fr" : "en" });
  if (employeeId) query.set("employeeId", employeeId);
  const text = buttonLabel ?? (report === "employee" ? (fr ? "Télécharger la fiche complète" : "Download full employee record") : (fr ? "Télécharger le PDF" : "Download PDF"));
  return <a href={orgApiUrl(orgSlug, "hr-reports/" + report + ".pdf?" + query.toString())} download className={"inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70 " + className}><FileText className="size-4" /><span className="min-w-0 flex-1 text-left">{text}</span><Download className="size-4 shrink-0" aria-hidden="true" /></a>;
}
