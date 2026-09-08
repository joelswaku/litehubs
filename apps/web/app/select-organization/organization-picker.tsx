"use client";
import { Building2, Loader2 } from "lucide-react";
import { useSwitchOrganization } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
import { useSession } from "@/hooks/useAuth";
export function OrganizationPicker() {
  const { t } = useLanguage();
  const session = useSession();
  const switchOrganization = useSwitchOrganization();
  const user = session.data;
  if (session.isPending)
    return (
      <div className="flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t("select.loading")}
      </div>
    );
  if (session.isError || !user)
    return <p className="text-sm text-critical">{t("select.sessionEnded")}</p>;
  if (user.organizations.length === 0)
    return (
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-secondary">
        {t("select.noCompany")}
      </p>
    );
  return (
    <div className="space-y-3">
      {user.organizations.map((organization) => (
        <button
          key={organization.id}
          type="button"
          onClick={() => switchOrganization.mutate(organization.slug)}
          disabled={switchOrganization.isPending}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-1 p-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          <span className="grid size-9 place-items-center rounded-md bg-brand-subtle text-brand">
            <Building2 className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {organization.displayName}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {organization.slug}
            </span>
          </span>
          {organization.isOwner ? (
            <span className="text-xs font-medium text-brand">
              {t("select.owner")}
            </span>
          ) : null}
        </button>
      ))}
      {switchOrganization.isPending ? (
        <div className="flex items-center gap-2 text-xs text-ink-secondary">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("select.opening")}
        </div>
      ) : null}
    </div>
  );
}
