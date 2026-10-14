"use client";

import Link from "next/link";
import { Bell, ChevronDown, LogOut, Menu, Moon, Search, Sun, User } from "lucide-react";
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
import { roleCaption, roleLabel } from "@/lib/role-labels";
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
  const { t, locale } = useLanguage();
  const user = useSessionUser();
  const notificationCenter = useOptionalNotificationCenter();
  const logout = useLogout();
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const toggleCommand = useUiStore((state) => state.toggleCommand);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setMounted(true);
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  const unread = notificationCenter?.unreadCount ?? 0;
  const iconButton =
    "relative grid size-9 place-items-center rounded-xl border border-transparent text-ink-secondary outline-none transition-all duration-200 hover:border-border hover:bg-surface-1 hover:text-ink hover:shadow-[0_1px_2px_rgba(15,23,42,.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:hover:bg-white/[0.06]";
  const roleText = roleCaption(user?.roles ?? [], locale);
  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface-1/80 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-1/70 sm:px-5 dark:bg-[color-mix(in_oklab,var(--surface-1)_82%,transparent)]">
      {/* A hairline of brand colour along the bottom edge ties the bar to the
          sidebar's glow without adding weight. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--brand)_45%,transparent)_30%,color-mix(in_oklab,var(--brand)_45%,transparent)_70%,transparent)] opacity-60"
      />
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className={cn(iconButton, "lg:hidden")}
        aria-label={t("header.openNavigation")}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {showOrgSwitcher ? <OrgSwitcher /> : null}
      {title ? (
        <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-ink">{title}</h1>
      ) : null}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleCommand}
          className="group hidden h-9 w-56 items-center gap-2 rounded-xl border border-border bg-surface-2/70 pl-3 pr-1.5 text-[13px] text-ink-muted shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] outline-none transition-all duration-200 hover:border-border-strong hover:bg-surface-1 hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex lg:w-64 xl:w-72 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
          aria-label={t("header.search")}
        >
          <Search className="size-4 shrink-0 transition-colors group-hover:text-brand" aria-hidden />
          <span className="flex-1 truncate text-left">{t("header.search")}…</span>
          <kbd className="flex h-6 items-center gap-0.5 rounded-md border border-border bg-surface-1 px-1.5 font-sans text-[10.5px] font-medium text-ink-muted shadow-[0_1px_0_var(--border)]">
            {mounted && !isMac ? "Ctrl" : "⌘"}
            <span>K</span>
          </kbd>
        </button>
        <button
          type="button"
          onClick={toggleCommand}
          className={cn(iconButton, "md:hidden")}
          aria-label={t("header.search")}
        >
          <Search className="size-4" aria-hidden />
        </button>
        <LanguageSwitcher className="mx-0.5" />
        <span aria-hidden className="mx-0.5 hidden h-6 w-px bg-border sm:block" />
        {notificationHref ? (
          <Link
            href={`${notificationHref}${notificationHref.includes("?") ? "&" : "?"}markRead=1`}
            className={iconButton}
            aria-label={t("header.unread", { count: unread })}
          >
            <Bell className={cn("size-[18px]", unread > 0 && "origin-top animate-[bell_2.4s_ease-in-out_1]")} aria-hidden />
            {notificationCenter && unread > 0 ? (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-critical px-1 text-center text-[10px] font-semibold leading-[18px] text-white shadow-[0_2px_8px_-1px_color-mix(in_oklab,var(--critical)_70%,transparent)] ring-2 ring-surface-1">
                {notificationCenter.formattedUnreadCount}
              </span>
            ) : null}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className={iconButton}
          aria-label={
            mounted && resolvedTheme === "dark"
              ? t("header.switchLight")
              : t("header.switchDark")
          }
        >
          {mounted ? (
            resolvedTheme === "dark" ? (
              <Sun className="size-[18px] text-warning" aria-hidden />
            ) : (
              <Moon className="size-[18px]" aria-hidden />
            )
          ) : (
            <span className="size-4" aria-hidden />
          )}
        </button>
        <div className="relative ml-1">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-xl border pl-1 pr-1 outline-none transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring xl:pr-2.5",
              menuOpen
                ? "border-border bg-surface-1 shadow-[0_1px_2px_rgba(15,23,42,.06)] dark:bg-white/[0.06]"
                : "border-transparent hover:border-border hover:bg-surface-1 dark:hover:bg-white/[0.06]",
            )}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("header.account")}
          >
            <span className="relative" aria-hidden>
              <span className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,color-mix(in_oklab,var(--brand)_85%,white),var(--brand-active))] text-[11px] font-semibold text-white shadow-[0_4px_12px_-4px_color-mix(in_oklab,var(--brand)_75%,transparent)] ring-2 ring-surface-1">
                {initialsOf(user?.fullName)}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-good ring-2 ring-surface-1" />
            </span>
            <span className="hidden min-w-0 max-w-36 text-left xl:block">
              <span className="block truncate text-[13px] font-semibold leading-tight text-ink">
                {user?.fullName ?? "—"}
              </span>
              {roleText ? (
                <span className="block truncate text-[11px] leading-tight text-ink-muted">
                  {roleText}
                </span>
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                "hidden size-3.5 text-ink-muted transition-transform duration-200 xl:block",
                menuOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div
                className="absolute right-0 z-50 mt-2 w-72 origin-top-right animate-[menu-in_160ms_ease-out] overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_24px_48px_-20px_rgba(15,23,42,.45),0_2px_6px_rgba(15,23,42,.06)] dark:shadow-[0_24px_48px_-16px_rgba(0,0,0,.7)]"
                role="menu"
              >
                <div className="relative overflow-hidden px-4 pb-4 pt-4">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--brand)_16%,transparent),transparent_65%)]"
                  />
                  <div className="relative flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,color-mix(in_oklab,var(--brand)_85%,white),var(--brand-active))] text-sm font-semibold text-white shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--brand)_75%,transparent)]">
                      {initialsOf(user?.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {user?.fullName ?? "—"}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {user?.email ?? ""}
                      </p>
                    </div>
                  </div>
                  {user?.roles.length ? (
                    <div className="relative mt-3 flex flex-wrap gap-1">
                      {user.roles.slice(0, 3).map((role) => (
                        <Badge key={role} variant="outline" icon={false}>
                          {roleLabel(role, locale)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {user?.isPlatformStaff ? (
                    <div className="relative mt-2">
                      <Link href="/platform" onClick={() => setMenuOpen(false)}>
                        <Badge variant="info">
                          {t("header.litehubsOwner")}
                        </Badge>
                      </Link>
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-border p-1.5">
                  {accountHref ? (
                    <Link
                      href={accountHref}
                      onClick={() => setMenuOpen(false)}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]"
                      role="menuitem"
                    >
                      <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-white dark:bg-brand/20 dark:text-brand-active">
                        <User className="size-4" aria-hidden />
                      </span>
                      {t("header.myAccount")}
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]"
                    role="menuitem"
                  >
                    <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-ink-secondary transition group-hover:text-ink dark:bg-white/[0.06]">
                      {mounted && resolvedTheme === "dark" ? (
                        <Sun className="size-4" aria-hidden />
                      ) : (
                        <Moon className="size-4" aria-hidden />
                      )}
                    </span>
                    {mounted && resolvedTheme === "dark"
                      ? t("header.switchLight")
                      : t("header.switchDark")}
                  </button>
                </div>
                <div className="border-t border-border p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout.mutate();
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-ink-secondary transition hover:bg-critical/10 hover:text-critical"
                    role="menuitem"
                  >
                    <span className="grid size-8 place-items-center rounded-lg bg-surface-2 transition group-hover:bg-critical/15 dark:bg-white/[0.06]">
                      <LogOut className="size-4" aria-hidden />
                    </span>
                    {t("header.signOut")}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
export { User as UserIcon };

