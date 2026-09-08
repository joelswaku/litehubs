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
    : "bg-surface-1 text-ink shadow-sm";
  const inactive = inverse
    ? "text-white/65 hover:bg-white/10 hover:text-white"
    : "text-ink-muted hover:bg-surface-2 hover:text-ink";

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border p-0.5 text-xs font-semibold",
        inverse
          ? "border-white/15 bg-white/[0.06]"
          : "border-border bg-surface-2",
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
          "rounded-md px-2 py-1 transition-colors",
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
          "rounded-md px-2 py-1 transition-colors",
          locale === "en" ? active : inactive,
        )}
        aria-pressed={locale === "en"}
      >
        EN
      </button>
    </div>
  );
}
