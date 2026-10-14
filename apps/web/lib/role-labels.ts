/** Readable role names for the interface chrome (sidebar, header, menus). */

export const ROLE_CAPTIONS: Record<string, [string, string]> = {
  owner: ["Propriétaire", "Owner"],
  general_manager: ["Directeur général", "General manager"],
  hr_officer: ["Responsable RH", "HR officer"],
  accountant: ["Comptable", "Accountant"],
  project_manager: ["Chef de projet", "Project manager"],
  supervisor: ["Superviseur", "Supervisor"],
  social_media_manager: ["Service client & réseaux", "Customer service & social"],
  feed_mill_manager: ["Responsable provenderie", "Feed mill manager"],
  fleet_controller: ["Responsable flotte", "Fleet controller"],
  storekeeper: ["Magasinier", "Storekeeper"],
  employee: ["Employé", "Employee"],
};

/** The most meaningful role, readable, in the interface language. */
export function roleCaption(roles: string[], locale: string): string | null {
  if (!roles.length) return null;
  const main = roles.find((role) => role !== "employee") ?? roles[0]!;
  const known = ROLE_CAPTIONS[main];
  if (known) return locale === "fr" ? known[0] : known[1];
  return main.replace(/_/g, " ");
}

/** One role code, readable, in the interface language. */
export function roleLabel(role: string, locale: string): string {
  const known = ROLE_CAPTIONS[role];
  if (known) return locale === "fr" ? known[0] : known[1];
  return role.replace(/_/g, " ");
}
