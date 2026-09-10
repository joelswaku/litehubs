"use client";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
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
      <section className="rounded-xl border border-brand/20 bg-brand-subtle/70 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Building2 className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
              {t("staff.companySetupKicker")}
            </p>
            <h2 className="mt-2 text-base font-semibold text-ink">
              {t("staff.companySetupTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {t("staff.companySetupDescription")}
            </p>
            <Link
              href="/staff/login/register"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand underline-offset-4 hover:underline"
            >
              {t("staff.companySetupAction")}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
