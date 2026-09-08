"use client";
import { AcceptInvitationForm } from "./accept-invitation-form";
import { useLanguage } from "@/providers/language-provider";
export function AcceptInvitationScreen() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {t("invite.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("invite.description")}</p>
      </div>
      <AcceptInvitationForm />
    </div>
  );
}
