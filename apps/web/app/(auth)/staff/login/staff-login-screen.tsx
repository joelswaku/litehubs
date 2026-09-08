"use client";
import Link from "next/link";
import { StaffLoginForm } from "./staff-login-form";
import { useLanguage } from "@/providers/language-provider";
export function StaffLoginScreen() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t("staff.kicker")}
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("staff.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("staff.description")}</p>
      </div>
      <StaffLoginForm />
      <p className="text-center text-xs text-ink-secondary">
        {t("staff.question")}{" "}
        <Link
          href="/login"
          className="font-medium text-brand underline-offset-4 hover:underline"
        >
          {t("staff.companySignIn")}
        </Link>
      </p>
    </div>
  );
}
