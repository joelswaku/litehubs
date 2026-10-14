"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";

export function LanguageSwitcher({
  inverse = false,
  className,
}: {
  inverse?: boolean;
  className?: string;
}) {
  const { locale, setLocale, t } = useLanguage();
  const active = inverse
    ? "bg-white text-[#10291f] shadow-sm"
    : "bg-surface-1 text-ink shadow-[0_1px_2px_rgba(15,23,42,.12)] dark:bg-white/[0.12]";
  const inactive = inverse
    ? "text-white/65 hover:bg-white/10 hover:text-white"
    : "text-ink-muted hover:bg-surface-2 hover:text-ink";

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center rounded-xl border p-1 text-[11px] font-semibold tracking-wide",
        inverse
          ? "border-white/15 bg-white/[0.06]"
          : "border-border bg-surface-2/70 dark:bg-white/[0.04]",
        className,
      )}
      role="group"
      aria-label={t("language.choose")}
    >
      <Languages
        className={cn(
          "ml-1.5 mr-1 size-3.5",
          inverse ? "text-emerald-100" : "text-brand",
        )}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => setLocale("fr")}
        className={cn(
          "h-full rounded-lg px-2.5 transition-all duration-200",
          locale === "fr" ? active : inactive,
        )}
        aria-pressed={locale === "fr"}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={cn(
          "h-full rounded-lg px-2.5 transition-all duration-200",
          locale === "en" ? active : inactive,
        )}
        aria-pressed={locale === "en"}
      >
        EN
      </button>
    </div>
  );
}
