"use client";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";
import { useLanguage } from "@/providers/language-provider";
export function ForgotPasswordScreen() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("forgot.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("forgot.description")}</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-xs text-ink-secondary">
        <Link
          href="/login"
          className="font-medium text-brand underline-offset-4 hover:underline"
        >
          {t("forgot.back")}
        </Link>
      </p>
    </div>
  );
}
