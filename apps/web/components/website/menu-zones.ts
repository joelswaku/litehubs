/**
 * Which site menus show a page's link: top bar, header and/or footer.
 *
 * Stored in the page settings: no value = every menu (the original
 * behaviour), `hideFromMenu: true` = no menu, `menuZones: [...]` = only those.
 */
export const MENU_ZONES = ["topbar", "header", "footer"] as const;
export type MenuZone = (typeof MENU_ZONES)[number];

export const MENU_ZONE_LABELS: Record<MenuZone, [string, string]> = {
  topbar: ["Top bar", "Top bar"],
  header: ["Header (menu principal)", "Header (main menu)"],
  footer: ["Footer (pied de page)", "Footer"],
};

type Settings = Record<string, unknown> | null | undefined;

/** The menus showing the page's link. */
export function pageMenuZones(settings: Settings): MenuZone[] {
  if (settings?.hideFromMenu === true) return [];
  const value = settings?.menuZones;
  if (!Array.isArray(value)) return [...MENU_ZONES];
  return MENU_ZONES.filter((zone) => value.includes(zone));
}

/** `zones` for the renderer: undefined when the link is in every menu. */
export function pageMenuZonesValue(settings: Settings): string[] | undefined {
  const zones = pageMenuZones(settings);
  return zones.length === MENU_ZONES.length ? undefined : zones;
}

/** Page settings after choosing the menus that show the link. */
export function settingsWithMenuZones(settings: Settings, zones: readonly MenuZone[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(settings ?? {}) };
  delete next.menuZones;
  delete next.hideFromMenu;
  const chosen = MENU_ZONES.filter((zone) => zones.includes(zone));
  if (chosen.length === 0) next.hideFromMenu = true;
  else if (chosen.length < MENU_ZONES.length) next.menuZones = chosen;
  return next;
}
