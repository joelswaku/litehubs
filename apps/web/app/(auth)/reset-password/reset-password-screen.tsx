"use client";
import { ResetPasswordForm } from "./reset-password-form";
import { useLanguage } from "@/providers/language-provider";
export function ResetPasswordScreen() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("reset.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("reset.description")}</p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
