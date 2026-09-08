"use client";
import { OrganizationPicker } from "./organization-picker";
import { useLanguage } from "@/providers/language-provider";
export function OrganizationPickerScreen() {
  const { t } = useLanguage();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <section className="w-full space-y-6 rounded-xl border border-border bg-surface-1 p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            LiteHubs
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {t("select.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("select.description")}
          </p>
        </div>
        <OrganizationPicker />
      </section>
    </main>
  );
}
