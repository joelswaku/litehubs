"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Drawer } from "vaul";
import { Header } from "@/components/layout/header";
import { GlobalSearchPalette } from "@/components/layout/global-search-palette";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useAuth";
import { useWorkspaceProfile } from "@/hooks/useWorkspace";
import { get, orgUrl, setActiveOrganizationSlug } from "@/lib/api";
import { WORKSPACE_NAV } from "@/lib/navigation";
import { notificationsApi } from "@/services/notification.service";
import { useLanguage } from "@/providers/language-provider";
import { NotificationProvider, useNotificationCenter } from "@/providers/notifications-provider";
import { useSessionUser } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";

export function WorkspaceShell({ orgSlug, children }: { orgSlug: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { data: user, isPending, isError } = useSession();
  setActiveOrganizationSlug(orgSlug);
  const belongsHere = user?.organizations.some((organization) => organization.slug === orgSlug);
  useEffect(() => {
    if (isError) { router.replace("/login"); return; }
    if (!user) return;
    if (!belongsHere) { router.replace("/select-organization"); return; }
    if (user.activeOrganization?.slug !== orgSlug) router.refresh();
  }, [user, isError, belongsHere, orgSlug, router]);
  if (isPending) return <div className="grid min-h-dvh place-items-center"><div className="flex items-center gap-2 text-sm text-ink-secondary" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />{t("workspace.loading")}</div></div>;
  if (!user || !belongsHere) return <div className="grid min-h-dvh place-items-center px-4"><div className="max-w-sm space-y-3 text-center"><h1 className="text-lg font-semibold text-ink">{t("workspace.notFound")}</h1><p className="text-sm text-ink-secondary">{t("workspace.notFoundDescription")}</p><Button onClick={() => router.replace("/select-organization")}>{t("workspace.choose")}</Button></div></div>;
  return <NotificationProvider orgSlug={orgSlug}><WorkspaceChrome orgSlug={orgSlug}>{children}</WorkspaceChrome></NotificationProvider>;
}

/** Applies the member's saved workspace language after sign-in and when switching organizations. */
function WorkspaceLanguagePreferenceSync({ orgSlug }: { orgSlug: string }) {
  const { setLocale } = useLanguage();
  const user = useSessionUser();
  const preferences = useQuery({
    queryKey: ["notification-preferences", orgSlug],
    queryFn: () => notificationsApi.preferences(orgSlug),
    enabled: Boolean(user),
    retry: false,
  });
  const preferredLanguage = preferences.data?.profile.preferredLanguage;

  useEffect(() => {
    if (preferredLanguage === "fr" || preferredLanguage === "en") setLocale(preferredLanguage);
  }, [preferredLanguage, setLocale]);

  return null;
}

function WorkspaceChrome({ orgSlug, children }: { orgSlug: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const user = useSessionUser();
  const { unreadCount } = useNotificationCenter();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const basePath = `/${orgSlug}`;
  const counts = { notifications: unreadCount };
  const profile = useWorkspaceProfile(orgSlug);
  const employeeProfile = useQuery({
    queryKey: ["training-current-employee", orgSlug, user?.id],
    queryFn: () => get<{ employee: { id: string } | null }>(orgUrl(orgSlug, "training-me")),
    enabled: Boolean(user),
    retry: false,
  });
  const groups = useMemo(
    () =>
      WORKSPACE_NAV.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            (!item.employeeProfileOnly || Boolean(employeeProfile.data?.employee)) &&
            (!item.hideForEmployeeProfile || !Boolean(employeeProfile.data?.employee)) &&
            isSelectedOperationalNavigation(item.path, profile.data?.operationalServices),
        ),
      })),
    [employeeProfile.data?.employee, profile.data?.operationalServices],
  );
  return <div className="flex h-dvh overflow-hidden bg-page">
    <WorkspaceLanguagePreferenceSync orgSlug={orgSlug} />
    <div className="hidden shrink-0 lg:block"><Sidebar groups={groups} basePath={basePath} counts={counts} /></div>
    <Drawer.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen} direction="left">
      <Drawer.Portal><Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" /><Drawer.Content className="fixed inset-y-0 left-0 z-50 w-60 outline-none lg:hidden"><Drawer.Title className="sr-only">{t("header.mainNavigation")}</Drawer.Title><Sidebar groups={groups} basePath={basePath} counts={counts} /></Drawer.Content></Drawer.Portal>
    </Drawer.Root>
    <div className="flex min-w-0 flex-1 flex-col"><Header notificationHref={`${basePath}/notifications`} accountHref={`${basePath}/my-account`} /><main className="scrollbar-thin flex-1 overflow-y-auto">{children}</main></div>
    <GlobalSearchPalette orgSlug={orgSlug} groups={groups} />
  </div>;
}
/** Operational setup is a navigation preference; API permissions still protect every direct route. */
function isSelectedOperationalNavigation(path: string, services: string[] | null | undefined): boolean {
  if (services == null) return true;
  if (path === "/poultry") return services.includes("poultry");
  if (path === "/pigs") return services.includes("pigs");
  if (path === "/agriculture") return services.includes("agriculture");
  if (path === "/veterinary") return services.includes("poultry") || services.includes("pigs");
  if (path === "/projects") return services.includes("projects");
  if (["/inventory", "/procurement", "/suppliers", "/equipment", "/maintenance"].includes(path)) return services.includes("procurement");
  return true;
}
