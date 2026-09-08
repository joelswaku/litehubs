"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PanelLeft } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn, initialsOf } from "@/lib/utils";
import { activeItemPath, type NavGroup } from "@/lib/navigation";
import { navTranslationKey } from "@/lib/i18n";
import { visiblePlatformTo, visibleTo } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { APP_NAME } from "@/lib/constants";
import { get, orgUrl } from "@/lib/api";

/**
 * The workspace and platform sidebar.
 *
 * An owner sees around twenty-five entries, so the whole design is about making
 * a long list quiet:
 *
 * - **One surface, one border, no gradients or shadows.** A navigation panel is
 *   chrome. Anything decorative here competes with the page, and with this many
 *   rows it compounds into noise.
 * - **The active row is the only coloured thing.** A 3px rail plus a neutral
 *   surface shift and brand-coloured label. Everything else is ink on surface,
 *   so the eye finds the current page immediately.
 * - **Group headings carry the structure**, with air above rather than below —
 *   that is what binds a label to the rows under it.
 * - **Icons stay muted until active or hovered.** Twenty-five saturated icons
 *   read as a toolbar; twenty-five grey ones read as a list.
 *
 * The brand sits here and the *workspace* name sits in the header. Putting both
 * in both places duplicated them on screen.
 */
export function Sidebar({
  groups,
  basePath,
  counts,
  plane = "workspace",
}: {
  groups: NavGroup[];
  basePath: string;
  counts?: Partial<Record<"alerts" | "approvals" | "notifications", number>>;
  plane?: "workspace" | "platform";
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const user = useSessionUser();

  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const collapsedGroups = useUiStore((state) => state.collapsedGroups);
  const toggleGroup = useUiStore((state) => state.toggleGroup);

  const slug = basePath.replace(/^\//, "");
  const workspaceProfile = useQuery({
    queryKey: ["workspace-profile", slug],
    enabled: plane === "workspace" && Boolean(slug),
    queryFn: () => get<{ organization: { displayName: string; legalName: string; logoUrl: string | null } }>(orgUrl(slug, "")),
    select: (data) => data.organization,
  });
  const workspaceName = workspaceProfile.data?.displayName || workspaceProfile.data?.legalName || slug || APP_NAME;
  const workspaceLogo = workspaceProfile.data?.logoUrl ?? null;
  const active = activeItemPath(pathname, slug, groups);

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items:
        plane === "platform"
          ? visiblePlatformTo(user, group.items)
          : visibleTo(user, group.items),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label={t("header.mainNavigation")}
      className={cn(
        "flex h-full flex-col border-r border-border bg-surface-1",
        collapsed ? "w-[60px]" : "w-[248px]",
        "transition-[width] duration-200 ease-out",
      )}
    >
      {/* ------------------------------------------------------- identity -- */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Link
          href={basePath || "/platform"}
          title={collapsed ? (plane === "workspace" ? workspaceName : APP_NAME) : undefined}
          className="flex min-w-0 items-center gap-2.5 rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {plane === "workspace" ? <>{workspaceLogo ? <img src={workspaceLogo} alt="" className="size-[27px] shrink-0 rounded-md border border-border bg-white object-contain p-0.5" /> : <span className="grid size-[27px] shrink-0 place-items-center rounded-md bg-brand text-[9px] font-bold tracking-tight text-white" aria-hidden>{initialsOf(workspaceName).slice(0, 2)}</span>}{!collapsed ? <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{workspaceName}</span> : null}</> : <><BrandMark size={26} />{!collapsed ? <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{APP_NAME}</span> : null}</>}
        </Link>
      </div>

      {/* ------------------------------------------------------------ nav -- */}
      {/* No search box here: the header's ⌘K trigger is always visible, and a
          second one duplicated it while costing the rows their space. */}
      <div
        className={cn(
          "scrollbar-thin flex-1 overflow-y-auto overscroll-contain py-2",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        {visibleGroups.map((group, groupIndex) => {
          const isFolded = collapsedGroups.includes(group.id);
          const holdsActive = group.items.some((item) => item.path === active);

          return (
            <div key={group.id} className={groupIndex === 0 ? "" : "mt-4"}>
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isFolded}
                  className="group/heading mb-1 flex w-full items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-muted transition-colors hover:text-ink-secondary"
                >
                  <span className="truncate">
                    {t(navTranslationKey(group.label))}
                  </span>
                  {/* A folded group holding the current page must still say so,
                      or the user loses their place. */}
                  {isFolded && holdsActive ? (
                    <span
                      className="size-1 shrink-0 rounded-full bg-brand"
                      aria-hidden
                    />
                  ) : null}
                  {/* The chevron only appears on hover or focus: twenty-five
                      rows already give the eye plenty to do. */}
                  <ChevronDown
                    className={cn(
                      "ml-auto size-3 shrink-0 opacity-0 transition-all duration-200",
                      "group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
                      isFolded && "-rotate-90 opacity-100",
                    )}
                    aria-hidden
                  />
                </button>
              ) : groupIndex > 0 ? (
                // Collapsed leaves no room for a label, so a divider carries the
                // grouping instead.
                <div className="mx-2.5 my-2 h-px bg-border" aria-hidden />
              ) : null}

              {!isFolded || collapsed ? (
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavRow
                      key={item.path}
                      href={`${basePath}${item.path}`}
                      label={t(navTranslationKey(item.label))}
                      icon={item.icon}
                      active={active === item.path}
                      collapsed={collapsed}
                      count={item.badge ? counts?.[item.badge] : undefined}
                      translate={t}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* --------------------------------------------------------- footer -- */}
      {/* The collapse control lives here permanently. In the header it appeared
          and disappeared with state, so it moved out from under the cursor at
          the moment it was clicked. */}
      <div
        className={cn(
          "flex shrink-0 items-center border-t border-border",
          collapsed ? "flex-col gap-1 px-2 py-2" : "gap-2 px-3 py-2.5",
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-secondary"
              aria-hidden
            >
              {initialsOf(user?.fullName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-tight text-ink">
                {user?.fullName ?? "—"}
              </span>
              <span className="block truncate text-[10px] leading-tight text-ink-muted">
                {user?.roles?.[0]?.replace(/_/g, " ") ?? user?.email ?? ""}
              </span>
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={
            collapsed ? t("header.expandSidebar") : t("header.collapseSidebar")
          }
          className="grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <PanelLeft
            className={cn(
              "size-4 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>
    </nav>
  );
}

/**
 * One navigation row.
 *
 * The active marker is a `motion` element with a shared `layoutId`, so it slides
 * from the previous row rather than two rows blinking. Exactly one exists at a
 * time, which is what makes sharing the id safe.
 */
function NavRow({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  count,
  translate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  count?: number | undefined;
  translate: (key: never, values?: Record<string, string | number>) => string;
}) {
  const hasCount = typeof count === "number" && count > 0;

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          // `relative` matters: the rail and the collapsed dot are absolutely
          // positioned. Without it they anchored to whatever ancestor happened
          // to be positioned and landed in the wrong place.
          "group relative flex items-center rounded-md text-[13px] transition-colors",
          collapsed ? "h-9 justify-center" : "h-[34px] gap-2.5 pl-3 pr-2",
          active
            ? "bg-surface-2 font-medium text-brand"
            : "text-ink-secondary hover:bg-surface-2/70 hover:text-ink",
        )}
      >
        {active ? (
          <motion.span
            layoutId="sidebar-active-rail"
            transition={{ type: "spring", stiffness: 520, damping: 42 }}
            className="absolute left-0 top-1/2 h-4.5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand"
            aria-hidden
          />
        ) : null}

        <span className="relative shrink-0">
          <Icon
            className={cn(
              "size-4 transition-colors",
              active ? "text-brand" : "text-ink-muted group-hover:text-ink-secondary",
            )}
            aria-hidden
          />
          {collapsed && hasCount ? (
            // Collapsed has no room for a number: the dot carries "something is
            // here" and the accessible name carries how many.
            <span
              className="absolute -right-1 -top-0.5 size-2 rounded-full bg-critical ring-2 ring-surface-1"
              aria-label={translate("header.unread" as never, { count })}
            />
          ) : null}
        </span>

        {!collapsed ? (
          <>
            <span className="truncate">{label}</span>
            {hasCount ? (
              <span className="ml-auto min-w-[18px] shrink-0 rounded-full bg-critical px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white tabular">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </>
        ) : null}
      </Link>
    </li>
  );
}
