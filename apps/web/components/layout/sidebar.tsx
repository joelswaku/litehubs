"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Fragment, useState } from "react";
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
import { roleCaption } from "@/lib/role-labels";

/**
 * The workspace and platform sidebar.
 *
 * An owner sees around twenty-five entries, so the whole design is about making
 * a long list quiet:
 *
 * The visual language matches the LiteEvent dashboard sidebar so the two
 * products read as one family: `rounded-xl` rows, a 3px left border as the
 * active accent, a brand tint behind the active row, and `gap-3` between icon
 * and label.
 *
 * - **The active accent is a left border, not an overlay.** Every row carries
 *   `border-l-[3px]`, transparent until active, so the label never shifts by
 *   three pixels when the current page changes. On a 12px radius the border
 *   follows the corner and reads as an accented tab rather than a stray tick.
 * - **The tint is what separates active from hover.** Both were `surface-2` at
 *   slightly different opacities, which is a difference you can measure but not
 *   see, so the current page did not announce itself. Dark mode needs a heavier
 *   tint than light: `brand/10` over a near-black surface is almost invisible.
 * - **Group headings carry the structure**, with air above rather than below —
 *   that is what binds a label to the rows under it. LiteEvent has six entries
 *   and needs no groups; an owner here sees around twenty-five.
 * - **Icons stay muted until active or hovered.** Twenty-five saturated icons
 *   read as a toolbar; twenty-five grey ones read as a list.
 * - **Rows are 36px, not LiteEvent's 40px.** Six entries at 40px fit anywhere;
 *   twenty-five plus six headings would run to about 1,270px and put the footer
 *   well below the fold on a laptop. 36px keeps the roomy feel and gives back
 *   roughly a hundred pixels.
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
  counts?: Partial<Record<"alerts" | "approvals" | "notifications" | "chat", number>>;
  plane?: "workspace" | "platform";
}) {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const user = useSessionUser();

  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const collapsedGroups = useUiStore((state) => state.collapsedGroups);
  const toggleGroup = useUiStore((state) => state.toggleGroup);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const slug = basePath.replace(/^\//, "");
  const workspaceProfile = useQuery({
    queryKey: ["workspace-profile", slug],
    enabled: plane === "workspace" && Boolean(slug),
    queryFn: () =>
      get<{
        organization: {
          displayName: string;
          legalName: string;
          logoUrl: string | null;
        };
      }>(orgUrl(slug, "")),
    select: (data) => data.organization,
  });
  const workspaceName =
    workspaceProfile.data?.displayName ||
    workspaceProfile.data?.legalName ||
    slug ||
    APP_NAME;
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
        // `select-none` because dragging across chrome and highlighting the
        // labels is never what someone meant to do in a nav panel.
        "relative flex h-full select-none flex-col border-r border-border",
        // A quiet vertical wash and a faint brand glow at the top give the
        // panel depth without competing with the page.
        "bg-[linear-gradient(180deg,var(--surface-1)_0%,color-mix(in_oklab,var(--surface-1)_94%,var(--brand))_100%)]",
        "dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface-1)_92%,black)_0%,var(--page)_100%)]",
        collapsed ? "w-[4.5rem]" : "w-[16.5rem]",
        "transition-[width] duration-300 ease-out",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--brand)_14%,transparent),transparent_70%)] dark:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--brand)_22%,transparent),transparent_70%)]"
      />
      {/* ------------------------------------------------------- identity -- */}
      <div
        className={cn(
          "relative flex h-16 shrink-0 items-center",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Link
          href={plane === "workspace" ? `${basePath}/dashboard` : "/platform"}
          onClick={() => setMobileNavOpen(false)}
          title={
            collapsed
              ? plane === "workspace"
                ? workspaceName
                : APP_NAME
              : undefined
          }
          className="flex min-w-0 items-center gap-2.5 rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {plane === "workspace" ? (
            <>
              {workspaceLogo ? (
                <img
                  src={workspaceLogo}
                  alt=""
                  className="size-9 shrink-0 rounded-xl bg-white object-contain p-1 shadow-[0_1px_2px_rgba(15,23,42,.08),0_6px_16px_-8px_rgba(15,23,42,.35)] ring-1 ring-black/5 dark:ring-white/10"
                />
              ) : (
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--brand),var(--brand-active))] text-[11px] font-bold tracking-tight text-white shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--brand)_70%,transparent)] ring-1 ring-white/20"
                  aria-hidden
                >
                  {initialsOf(workspaceName).slice(0, 2)}
                </span>
              )}
              {!collapsed ? (
                <span className="min-w-0">
                  <span className="block truncate text-[0.9rem] font-semibold leading-tight tracking-[-0.015em] text-ink">
                    {workspaceName}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium leading-tight text-ink-muted">
                    {t("sidebar.workspaceCaption")}
                  </span>
                </span>
              ) : null}
            </>
          ) : (
            <>
              <BrandMark size={26} />
              {!collapsed ? (
                <span className="truncate text-sm font-semibold tracking-[-0.011em] text-ink">
                  {APP_NAME}
                </span>
              ) : null}
            </>
          )}
        </Link>
      </div>

      <div
        aria-hidden
        className={cn(
          "h-px shrink-0 bg-[linear-gradient(90deg,transparent,var(--border)_20%,var(--border)_80%,transparent)]",
          collapsed ? "mx-3" : "mx-4",
        )}
      />
      {/* ------------------------------------------------------------ nav -- */}
      {/* No search box here: the header's ⌘K trigger is always visible, and a
          second one duplicated it while costing the rows their space. */}
      <div
        className={cn(
          "scrollbar-thin relative flex-1 overflow-y-auto overscroll-contain py-4",
          collapsed ? "px-2.5" : "px-3",
        )}
      >
        {visibleGroups.map((group, groupIndex) => {
          const isFolded = collapsedGroups.includes(group.id);
          const holdsActive = group.items.some((item) => item.path === active);

          return (
            <div key={group.id} className={groupIndex === 0 ? "" : "mt-6"}>
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isFolded}
                  className="group/heading mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted/90 transition-colors hover:text-ink-secondary"
                >
                  <span className="truncate">
                    {t(navTranslationKey(group.label))}
                  </span>
                  <span
                    aria-hidden
                    className="h-px min-w-3 flex-1 bg-[linear-gradient(90deg,var(--border),transparent)]"
                  />
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
                      "size-3 shrink-0 opacity-0 transition-all duration-200",
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
                  {group.items
                    .filter((item) => !item.parentPath)
                    .map((item) => {
                      const children = group.items.filter(
                        (candidate) => candidate.parentPath === item.path,
                      );
                      const childIsActive = children.some(
                        (child) => child.path === active,
                      );
                      const expanded =
                        expandedItems.includes(item.path) || childIsActive;
                      const toggleChildren = () =>
                        setExpandedItems((current) =>
                          current.includes(item.path)
                            ? current.filter((path) => path !== item.path)
                            : [...current, item.path],
                        );

                      return (
                        <Fragment key={item.path}>
                          <NavRow
                            href={`${basePath}${item.path}`}
                            label={t(navTranslationKey(item.label))}
                            icon={item.icon}
                            active={active === item.path}
                            collapsed={collapsed}
                            count={
                              item.badge ? counts?.[item.badge] : undefined
                            }
                            mobileOnly={item.mobileOnly}
                            translate={t}
                            onClick={
                              children.length && !collapsed
                                ? toggleChildren
                                : undefined
                            }
                          />
                          {children.length && expanded && !collapsed ? (
                            <li className="ml-[1.4rem] border-l border-border/80 pl-2.5">
                              <ul className="space-y-0.5 py-1">
                                {children.map((child) => (
                                  <NavRow
                                    key={child.path}
                                    href={`${basePath}${child.path}`}
                                    label={t(navTranslationKey(child.label))}
                                    icon={child.icon}
                                    active={active === child.path}
                                    collapsed={false}
                                    count={
                                      child.badge
                                        ? counts?.[child.badge]
                                        : undefined
                                    }
                                    mobileOnly={child.mobileOnly}
                                    translate={t}
                                  />
                                ))}
                              </ul>
                            </li>
                          ) : null}
                        </Fragment>
                      );
                    })}
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
          "relative shrink-0",
          collapsed ? "flex flex-col items-center gap-2 px-2 py-3" : "p-3",
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed
              ? "flex-col gap-2"
              : "gap-2.5 rounded-2xl border border-border bg-surface-1/80 p-2 shadow-[0_1px_2px_rgba(15,23,42,.04),0_8px_24px_-16px_rgba(15,23,42,.35)] backdrop-blur dark:bg-white/[0.03] dark:shadow-none",
          )}
        >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="relative shrink-0" aria-hidden>
              <span className="grid size-9 place-items-center rounded-full bg-[linear-gradient(135deg,color-mix(in_oklab,var(--brand)_85%,white),var(--brand-active))] text-[11px] font-semibold text-white ring-2 ring-surface-1 dark:ring-surface-2">
                {initialsOf(user?.fullName)}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-good ring-2 ring-surface-1" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-snug text-ink">
                {user?.fullName ?? "—"}
              </span>
              {/* Capitalised because the role arrives as a snake_case code —
                  "owner", "platform_super_admin" — and a raw identifier under
                  someone's name reads as a leaked internal. Scoped to the role
                  because the fallback is an email address, and "Joel@..." looks
                  like a typo rather than a tidier address. */}
              <span
                className={cn(
                  "block truncate text-[11px] leading-snug text-ink-muted",
                  user?.roles?.[0] && "capitalize",
                )}
              >
                {roleCaption(user?.roles ?? [], locale) ?? user?.email ?? ""}
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
          title={
            collapsed ? t("header.expandSidebar") : t("header.collapseSidebar")
          }
          className="grid size-8 shrink-0 place-items-center rounded-xl border border-transparent text-ink-muted outline-none transition-all hover:border-border hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {collapsed ? (
            <ChevronsRight className="size-4" aria-hidden />
          ) : (
            <ChevronsLeft className="size-4" aria-hidden />
          )}
        </button>
        </div>
      </div>
    </nav>
  );
}

/**
 * One navigation row.
 *
 * The active marker used to be a `motion` element with a shared `layoutId` that
 * slid between rows. It is a plain left border now: the sliding rail and a
 * border accent are the same affordance drawn twice, and the border is the one
 * that matches LiteEvent. Losing the animation is the cost — worth paying for a
 * marker that cannot drift out of sync with the row it belongs to.
 */
function NavRow({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  count,
  mobileOnly,
  translate,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  count?: number | undefined;
  mobileOnly?: boolean;
  translate: (key: never, values?: Record<string, string | number>) => string;
  onClick?: () => void;
}) {
  const hasCount = typeof count === "number" && count > 0;
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <li className={mobileOnly ? "lg:hidden" : undefined}>
      <Link
        href={href}
        onClick={() => {
          onClick?.();
          // The same Sidebar component is rendered in the mobile drawer. A
          // navigation choice should always reveal the destination rather than
          // leaving the drawer in front of it; on desktop this is a no-op.
          setMobileNavOpen(false);
        }}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          // `relative` matters: the collapsed unread dot is absolutely
          // positioned. Without it the dot anchored to whatever ancestor
          // happened to be positioned and landed in the wrong place.
          // The border sits on every row, transparent when inactive, so the
          // label does not jump three pixels as the active row changes.
          "group relative flex items-center rounded-xl text-[13.5px] font-medium outline-none transition-all duration-200",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          collapsed ? "mx-auto h-10 w-10 justify-center" : "h-10 gap-3 pl-2 pr-2.5",
          active
            ? // A soft brand wash with a hairline ring and a lifted shadow in
              // light; a heavier wash in dark, where /10 would vanish. Dark keeps
              // `brand-active` for the label so 14px text clears 4.5:1.
              "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--brand)_14%,var(--surface-1)),color-mix(in_oklab,var(--brand)_6%,var(--surface-1)))] text-brand shadow-[0_1px_2px_rgba(15,23,42,.06),inset_0_0_0_1px_color-mix(in_oklab,var(--brand)_22%,transparent)] dark:bg-[linear-gradient(90deg,color-mix(in_oklab,var(--brand)_26%,transparent),color-mix(in_oklab,var(--brand)_10%,transparent))] dark:text-brand-active dark:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
            : "text-ink-secondary hover:bg-surface-2/80 hover:text-ink dark:hover:bg-white/[0.05]",
        )}
      >
        {active && !collapsed ? (
          // A rounded indicator pill rather than a border, so it never shifts
          // the label and reads as a deliberate mark.
          <span
            aria-hidden
            className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand shadow-[0_0_10px_color-mix(in_oklab,var(--brand)_70%,transparent)] dark:bg-brand-active"
          />
        ) : null}
        <span
          className={cn(
            "relative grid shrink-0 place-items-center rounded-lg transition-all duration-200",
            collapsed ? "size-9" : "size-7",
            active
              ? "bg-[linear-gradient(135deg,var(--brand),var(--brand-active))] text-white shadow-[0_4px_12px_-4px_color-mix(in_oklab,var(--brand)_80%,transparent)] dark:bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_70%,black))]"
              : "text-ink-muted group-hover:bg-surface-1 group-hover:text-ink-secondary group-hover:shadow-[0_1px_2px_rgba(15,23,42,.08)] dark:group-hover:bg-white/[0.06]",
          )}
        >
          <Icon className="size-[15px]" aria-hidden />
          {collapsed && hasCount ? (
            // Collapsed has no room for a number: the dot carries "something is
            // here" and the accessible name carries how many.
            <span
              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-critical ring-2 ring-surface-1"
              aria-label={translate("header.unread" as never, { count })}
            />
          ) : null}
        </span>

        {!collapsed ? (
          <>
            <span className="truncate">{label}</span>
            {hasCount ? (
              <span className="ml-auto min-w-5 shrink-0 rounded-full bg-critical px-1.5 py-[3px] text-center text-[10px] font-semibold leading-none text-white shadow-[0_2px_6px_-1px_color-mix(in_oklab,var(--critical)_60%,transparent)] tabular">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </>
        ) : null}
      </Link>
    </li>
  );
}

