"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PanelLeft } from "lucide-react";
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
        "flex h-full select-none flex-col border-r border-border bg-surface-1",
        collapsed ? "w-16" : "w-64",
        "transition-[width] duration-300 ease-out",
      )}
    >
      {/* ------------------------------------------------------- identity -- */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Link
          href={plane === "workspace" ? `${basePath}/dashboard` : "/platform"}
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
                  className="size-7 shrink-0 rounded-md border border-border bg-white object-contain p-0.5"
                />
              ) : (
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-[10px] font-semibold tracking-tight text-brand-ink"
                  aria-hidden
                >
                  {initialsOf(workspaceName).slice(0, 2)}
                </span>
              )}
              {!collapsed ? (
                <span className="truncate text-sm font-semibold tracking-[-0.011em] text-ink">
                  {workspaceName}
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

      {/* ------------------------------------------------------------ nav -- */}
      {/* No search box here: the header's ⌘K trigger is always visible, and a
          second one duplicated it while costing the rows their space. */}
      <div
        className={cn(
          "scrollbar-thin flex-1 overflow-y-auto overscroll-contain py-3",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {visibleGroups.map((group, groupIndex) => {
          const isFolded = collapsedGroups.includes(group.id);
          const holdsActive = group.items.some((item) => item.path === active);

          return (
            <div key={group.id} className={groupIndex === 0 ? "" : "mt-5"}>
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isFolded}
                  className="group/heading mb-1.5 flex w-full items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-ink-secondary"
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
                <ul className="space-y-1">
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
                            <li className="ml-5 border-l border-border pl-2">
                              <ul className="space-y-1 py-1">
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
          "flex shrink-0 items-center border-t border-border",
          collapsed ? "flex-col gap-1 px-2 py-3" : "gap-2 p-3",
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-[10px] font-semibold text-ink-secondary"
              aria-hidden
            >
              {initialsOf(user?.fullName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-snug text-ink">
                {user?.fullName ?? "—"}
              </span>
              {/* Capitalised because the role arrives as a snake_case code —
                  "owner", "platform_super_admin" — and a raw identifier under
                  someone's name reads as a leaked internal. Scoped to the role
                  because the fallback is an email address, and "Joel@..." looks
                  like a typo rather than a tidier address. */}
              <span
                className={cn(
                  "block truncate text-[10px] leading-snug text-ink-muted",
                  user?.roles?.[0] && "capitalize",
                )}
              >
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
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

  return (
    <li className={mobileOnly ? "lg:hidden" : undefined}>
      <Link
        href={href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          // `relative` matters: the collapsed unread dot is absolutely
          // positioned. Without it the dot anchored to whatever ancestor
          // happened to be positioned and landed in the wrong place.
          // The border sits on every row, transparent when inactive, so the
          // label does not jump three pixels as the active row changes.
          "group relative flex items-center rounded-xl border-l-[3px] text-sm font-medium outline-none transition-all duration-200",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          collapsed ? "h-9 justify-center" : "h-9 gap-3 px-3",
          active
            ? // A brand tint rather than `surface-2`, which hover already owns.
              // Dark carries a heavier tint: `/10` over a near-black surface is
              // effectively invisible, where over a near-white one it is plenty.
              //
              // Dark uses `brand-active`, the lighter step, rather than `brand`.
              // The label has to stay blue, and `brand` (#3987e5) on this tinted
              // row measures 3.69:1 — under the 4.5:1 that 14px text needs, so it
              // reads as slightly smudged rather than crisp. `brand-active`
              // (#6da7ec) is the same hue at 5.37:1.
              "border-brand bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-active"
            : "border-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink",
        )}
      >
        <span className="relative shrink-0">
          <Icon
            className={cn(
              "size-4 transition-colors",
              // Active inherits the row colour instead of pinning `text-brand`,
              // so it follows the row's dark-mode override rather than staying
              // blue against a near-white label.
              active
                ? "text-current"
                : "text-ink-muted group-hover:text-ink-secondary",
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
              <span className="ml-auto min-w-4.5 shrink-0 rounded-full bg-critical px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white tabular">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </>
        ) : null}
      </Link>
    </li>
  );
}
