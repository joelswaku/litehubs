"use client";

import Link from "next/link";
import { Bell, LogOut, Menu, Moon, Search, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn, initialsOf } from "@/lib/utils";
import { useLogout } from "@/hooks/useAuth";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { OrgSwitcher } from "./org-switcher";
import { useOptionalNotificationCenter } from "@/providers/notifications-provider";

export function Header({
  showOrgSwitcher = true,
  title,
  notificationHref,
  accountHref,
}: {
  showOrgSwitcher?: boolean;
  title?: string;
  notificationHref?: string;
  accountHref?: string;
}) {
  const { t } = useLanguage();
  const user = useSessionUser();
  const notificationCenter = useOptionalNotificationCenter();
  const logout = useLogout();
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const toggleCommand = useUiStore((state) => state.toggleCommand);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-3 sm:px-4">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="grid size-9 place-items-center rounded-md text-ink-secondary hover:bg-surface-2 lg:hidden"
        aria-label={t("header.openNavigation")}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {showOrgSwitcher ? <OrgSwitcher /> : null}
      {title ? (
        <h1 className="truncate text-sm font-semibold text-ink">{title}</h1>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={toggleCommand}
          className="hidden items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink-secondary sm:flex"
          aria-label={t("header.search")}
        >
          <Search className="size-3.5" aria-hidden />
          <span>{t("header.search")}</span>
          <kbd className="rounded border border-border bg-surface-1 px-1 font-sans text-[10px]">
            ⌘K
          </kbd>
        </button>
        <LanguageSwitcher className="mr-1" />
        {notificationHref ? (
          <Link href={notificationHref} className="relative grid size-9 place-items-center rounded-md text-ink-secondary hover:bg-surface-2 hover:text-ink" aria-label={t("header.unread", { count: notificationCenter?.unreadCount ?? 0 })}>
            <Bell className="size-4" aria-hidden />
            {notificationCenter && notificationCenter.unreadCount > 0 ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-critical px-1 text-center text-[10px] font-semibold leading-4 text-white">{notificationCenter.formattedUnreadCount}</span> : null}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="grid size-9 place-items-center rounded-md text-ink-secondary hover:bg-surface-2 hover:text-ink"
          aria-label={
            mounted && resolvedTheme === "dark"
              ? t("header.switchLight")
              : t("header.switchDark")
          }
        >
          {mounted ? (
            resolvedTheme === "dark" ? (
              <Sun className="size-4" aria-hidden />
            ) : (
              <Moon className="size-4" aria-hidden />
            )
          ) : (
            <span className="size-4" aria-hidden />
          )}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="grid size-9 place-items-center rounded-md hover:bg-surface-2"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("header.account")}
          >
            <span
              className="grid size-7 place-items-center rounded-full bg-brand text-[11px] font-semibold text-brand-ink"
              aria-hidden
            >
              {initialsOf(user?.fullName)}
            </span>
          </button>
          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div
                className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface-1 shadow-lg"
                role="menu"
              >
                <div className="border-b border-border px-3 py-2.5">
                  <p className="truncate text-sm font-medium text-ink">
                    {user?.fullName ?? "—"}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {user?.email ?? ""}
                  </p>
                  {user?.roles.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {user.roles.slice(0, 3).map((role) => (
                        <Badge key={role} variant="outline" icon={false}>
                          {role.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {user?.isPlatformStaff ? (
                    <div className="mt-2">
                      <Link href="/platform" onClick={() => setMenuOpen(false)}>
                        <Badge variant="info">
                          {t("header.litehubsOwner")}
                        </Badge>
                      </Link>
                    </div>
                  ) : null}
                </div>
                {accountHref ? (
                  <Link
                    href={accountHref}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium",
                      "text-ink-secondary transition hover:bg-brand-subtle hover:text-brand",
                    )}
                    role="menuitem"
                  >
                    <User className="size-4" aria-hidden />
                    {t("header.myAccount")}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout.mutate();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm",
                    "text-ink-secondary transition hover:bg-surface-2 hover:text-ink",
                  )}
                  role="menuitem"
                >
                  <LogOut className="size-4" aria-hidden />
                  {t("header.signOut")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
export { User as UserIcon };
