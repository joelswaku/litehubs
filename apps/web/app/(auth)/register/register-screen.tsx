"use client";

import Link from "next/link";
import { RegisterForm } from "./register-form";
import { useLanguage } from "@/providers/language-provider";

export function RegisterScreen() {
  const { t } = useLanguage();
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          {t("register.kicker")}
        </p>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-[2rem]">
            {t("register.title")}
          </h1>
          <p className="max-w-sm text-sm leading-6 text-ink-secondary">
            {t("register.description")}
          </p>
        </div>
      </div>
      <RegisterForm />
      <p className="border-t border-border pt-6 text-center text-sm text-ink-secondary">
        {t("register.already")}{" "}
        <Link
          href="/login"
          className="font-semibold text-brand underline-offset-4 hover:underline"
        >
          {t("register.signIn")}
        </Link>
      </p>
    </div>
  );
}
