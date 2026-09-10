"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "vaul";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { useSession } from "@/hooks/useAuth";
import { landingPathFor } from "@/lib/auth";
import { setActiveOrganizationSlug } from "@/lib/api";
import { PLATFORM_NAV } from "@/lib/navigation";
import { useLanguage } from "@/providers/language-provider";
import { useUiStore } from "@/stores/ui-store";

/** A separate shell for people operating LiteHubs itself. It deliberately has
 * no organization switcher and never mounts the workspace navigation. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const router = useRouter();
  // A previous company session can leave an organization header in memory.
  // Platform requests must never be resolved inside that customer workspace.
  setActiveOrganizationSlug(null);
  const { data: user, isPending, isError } = useSession();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  useEffect(() => {
    if (isError) {
      router.replace("/staff");
      return;
    }
    if (user && !user.isPlatformStaff) router.replace(landingPathFor(user));
  }, [isError, user, router]);

  if (isPending || !user || !user.isPlatformStaff) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div
          className="flex items-center gap-2 text-sm text-ink-secondary"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("platform.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-page">
      <div className="hidden shrink-0 lg:block">
        <Sidebar groups={PLATFORM_NAV} basePath="" plane="platform" />
      </div>
      <Drawer.Root
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        direction="left"
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-y-0 left-0 z-50 w-60 outline-none lg:hidden">
            <Drawer.Title className="sr-only">
              {t("header.mainNavigation")}
            </Drawer.Title>
            <Sidebar groups={PLATFORM_NAV} basePath="" plane="platform" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header showOrgSwitcher={false} title={t("platform.kicker")} />
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
