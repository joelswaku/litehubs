import {
  Activity,
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  BookOpenCheck,
  BarChart3,
  Bell,
  Bird,
  Boxes,
  Building2,
  CalendarClock,
  CarFront,
  CircleUserRound,
  ClipboardCheck,
  ClipboardList,
  Contact,
  FileText,
  Factory,
  FolderKanban,
  GraduationCap,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Mail,
  PanelsTopLeft,
  type LucideIcon,
  Package,
  PiggyBank,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sprout,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { PermissionCode } from "./permissions";

/**
 * The workspace sidebar, as data.
 *
 * Every entry declares the permission that reveals it, and the sidebar is
 * rendered by filtering this list against the caller's permissions for the
 * *active* workspace. That is the whole mechanism, and it is why there is one
 * sidebar rather than seventeen: a storekeeper and an owner run this same array
 * and simply survive different filters.
 *
 * Keyed on permissions rather than role codes deliberately. Roles are
 * per-organization rows a customer can rename or redefine, so a nav keyed to
 * `role === "site_manager"` breaks the first time someone edits their roles.
 * What a role can *do* is stable; what it is *called* is not.
 *
 * A group with no visible items is dropped whole, so nobody sees an empty
 * heading.
 */

export interface NavItem {
  label: string;
  /** Optional parent item in the same sidebar group. */
  parentPath?: string;
  /** Appended to `/{orgSlug}`. */
  path: string;
  icon: LucideIcon;
  /** Any one of these reveals the item. Absent means always visible. */
  permission?: PermissionCode | PermissionCode[];
  /** Shows a live count badge, fetched by the sidebar. */
  badge?: "alerts" | "approvals" | "notifications";
  /** Additional role requirement for a platform-console entry. */
  platformRole?: string | string[];
  /** Visible only to the owner of the active workspace. */
  ownerOnly?: boolean;
  /** HR directory: Owner, HR Officer and recognised Manager roles only. */
  peopleDirectoryOnly?: boolean;
  /** Only shown once the signed-in member has an active employee profile. */
  employeeProfileOnly?: boolean;
  /** Hidden for employee profiles when the same destination is offered as a personal shortcut. */
  hideForEmployeeProfile?: boolean;
  /** Personal shortcut shown in the mobile drawer, while desktop stays uncluttered. */
  mobileOnly?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const WORKSPACE_NAV: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
      {
        label: "Alerts",
        path: "/alerts",
        icon: AlertTriangle,
        permission: "alerts.read",
        badge: "alerts",
      },
      {
        label: "Approvals",
        path: "/approvals",
        icon: ClipboardCheck,
        permission: "approvals.read",
        badge: "approvals",
      },
      {
        label: "Daily work",
        path: "/daily-work",
        icon: Activity,
        permission: "daily_operations.read",
        hideForEmployeeProfile: true,
      },
    ],
  },

  {
    id: "people",
    label: "People",
    items: [
      {
        label: "My account",
        path: "/my-account",
        icon: CircleUserRound,
        employeeProfileOnly: true,
      },
      {
        label: "Daily work",
        path: "/daily-work",
        icon: Activity,
        permission: "daily_operations.read",
        employeeProfileOnly: true,
      },
      {
        label: "My tasks",
        path: "/my-tasks",
        icon: ClipboardList,
        employeeProfileOnly: true,
      },
      {
        label: "My vehicle / engine",
        path: "/my-fleet",
        icon: CarFront,
        // This is a personal, API-scoped screen. It also serves a fleet or
        // maintenance controller who has an organisation membership but whose
        // HR employee card has not yet been created.
      },
      {
        label: "My schedule",
        path: "/my-schedule",
        icon: CalendarClock,
        employeeProfileOnly: true,
      },
      {
        label: "My leave",
        path: "/my-leave",
        icon: FileText,
        employeeProfileOnly: true,
      },
      {
        label: "My attendance",
        path: "/my-attendance",
        icon: CalendarClock,
        employeeProfileOnly: true,
      },
      {
        label: "My payslips",
        path: "/my-payslips",
        icon: Wallet,
        employeeProfileOnly: true,
      },
      {
        label: "Payment history",
        parentPath: "/my-payslips",
        path: "/my-pay-history",
        icon: Receipt,
        employeeProfileOnly: true,
      },
      {
        label: "My contracts",
        path: "/my-contracts",
        icon: FileText,
        employeeProfileOnly: true,
      },
      {
        label: "Careers",
        path: "/careers",
        icon: BriefcaseBusiness,
        permission: "careers.read",
      },
      {
        label: "Employees",
        path: "/employees",
        icon: Users,
        permission: "employees.read",
        peopleDirectoryOnly: true,
      },
      {
        label: "Attendance",
        path: "/attendance",
        icon: CalendarClock,
        permission: "attendance.read",
        hideForEmployeeProfile: true,
      },
      {
        label: "Shifts",
        path: "/shifts",
        icon: CalendarClock,
        permission: "shifts.read",
      },
      {
        label: "Leave",
        path: "/leave",
        icon: FileText,
        permission: "leave.read",
        hideForEmployeeProfile: true,
      },
      {
        label: "My trainings",
        path: "/my-trainings",
        icon: BookOpenCheck,
        employeeProfileOnly: true,
      },
      {
        label: "My performance",
        path: "/my-performance",
        icon: BarChart3,
        employeeProfileOnly: true,
      },
      {
        label: "Training",
        path: "/training",
        icon: GraduationCap,
        permission: "training.create",
      },
      {
        label: "Discipline",
        path: "/disciplinary-actions",
        icon: ScrollText,
        permission: "disciplinary_actions.read",
      },
      {
        label: "Performance",
        path: "/performance",
        icon: BarChart3,
        permission: "performance.read",
      },
      {
        label: "Payroll",
        path: "/payroll",
        icon: Wallet,
        permission: "payroll.read",
      },
    ],
  },

  {
    id: "production",
    label: "Production",
    items: [
      {
        label: "Poultry",
        path: "/poultry",
        icon: Bird,
        // Poultry employees do not see the management console, but they can
        // reach their personally assigned poultry work.
        permission: ["poultry.flocks.read", "poultry.daily_records.read"],
      },
      {
        label: "Pigs",
        path: "/pigs",
        icon: PiggyBank,
        permission: "pigs.animals.read",
      },
      {
        label: "Agriculture",
        path: "/agriculture",
        icon: Sprout,
        permission: "agriculture.farms.read",
      },
      {
        label: "Veterinary",
        path: "/veterinary",
        icon: HeartPulse,
        permission: [
          "poultry.health.read",
          "poultry.mortality.read",
          "poultry.vaccinations.read",
          "poultry.treatments.read",
          "poultry.biosecurity.read",
          "pigs.health.read",
          "pigs.mortality.read",
          "pigs.vaccinations.read",
          "pigs.treatments.read",
          "pigs.quarantine.read",
          "pigs.veterinary.read",
        ],
      },
    ],
  },

  {
    id: "operations",
    label: "Operations",
    items: [
      {
        label: "Projects",
        path: "/projects",
        icon: FolderKanban,
        permission: "projects.read",
      },
      {
        label: "Project analytics",
        path: "/project-analytics",
        icon: BarChart3,
        permission: "projects.read",
      },
      {
        label: "Tasks",
        path: "/tasks",
        icon: ClipboardList,
        permission: "tasks.read",
      },
      {
        label: "Appointments",
        path: "/appointments",
        icon: CalendarClock,
        permission: "appointments.read",
      },
      {
        label: "Inventory",
        path: "/inventory",
        icon: Boxes,
        permission: "inventory.items.read",
      },
      {
        label: "Feed mill & nutrition",
        path: "/feed-mill",
        icon: Factory,
        permission: "inventory.nutrition.read",
      },
      {
        label: "Raw materials & harvests",
        parentPath: "/feed-mill",
        path: "/feed-mill/raw-materials",
        icon: Boxes,
        permission: "inventory.nutrition.read",
      },
      {
        label: "Formulations & recipes",
        parentPath: "/feed-mill",
        path: "/feed-mill/recipes",
        icon: ClipboardList,
        permission: "inventory.nutrition.read",
      },
      {
        label: "Production orders",
        parentPath: "/feed-mill",
        path: "/feed-mill/production-orders",
        icon: Factory,
        permission: "inventory.nutrition.read",
      },
      {
        label: "Planning & requirements",
        parentPath: "/feed-mill",
        path: "/feed-mill/planning",
        icon: Activity,
        permission: "inventory.nutrition.read",
      },
      {
        label: "Procurement",
        path: "/procurement",
        icon: Package,
        permission: "procurement.read",
      },
      {
        label: "Suppliers",
        path: "/suppliers",
        icon: Truck,
        permission: "suppliers.read",
      },
      {
        label: "Equipment",
        path: "/equipment",
        icon: Wrench,
        permission: "equipment.read",
      },
      {
        label: "Fleet control",
        path: "/fleet-control",
        icon: CarFront,
        permission: "vehicles.fleet_control.read",
      },
      {
        label: "Maintenance",
        path: "/maintenance",
        icon: Wrench,
        permission: "maintenance.read",
      },
    ],
  },

  {
    id: "commercial",
    label: "Sales & money",
    items: [
      {
        label: "Customers",
        path: "/customers",
        icon: Contact,
        permission: "customers.read",
      },
      {
        label: "Sales",
        path: "/sales",
        icon: ShoppingCart,
        permission: "sales.read",
      },
      {
        label: "Invoices",
        path: "/invoices",
        icon: Receipt,
        permission: "sales.read",
      },
      {
        label: "Finance",
        path: "/finance",
        icon: Landmark,
        permission: ["finance.accounts.read", "finance.transactions.read"],
      },
      {
        label: "Cash",
        path: "/finance/cash",
        icon: Banknote,
        permission: "finance.cash_management.read",
      },
    ],
  },

  {
    id: "compliance",
    label: "Compliance",
    items: [
      {
        label: "Incidents",
        path: "/incidents",
        icon: AlertTriangle,
        permission: "incidents.read",
      },
      {
        label: "Security",
        path: "/security",
        icon: ShieldCheck,
        permission: "security.read",
      },
      {
        label: "Documents",
        path: "/documents",
        icon: FileText,
        permission: "documents.read",
      },
      {
        label: "Contracts",
        path: "/contracts",
        icon: ScrollText,
        permission: "contracts.read",
      },
      {
        label: "Reports",
        path: "/reports",
        icon: BarChart3,
        permission: "reports.read",
      },
      {
        label: "Audit",
        path: "/audit",
        icon: ScrollText,
        permission: "audit.read",
      },
      {
        label: "Company rules",
        path: "/company-rules",
        icon: BookOpenCheck,
      },
      // One entry point for the owner and the members the owner made website
      // managers (role library). Its own workspace contains pages, blocks,
      // design, media, preview and publication.
      {
        label: "Website",
        path: "/website",
        icon: PanelsTopLeft,
        permission: "website.read",
      },
    ],
  },

  {
    id: "workspace",
    label: "Workspace",
    items: [
      {
        label: "Notifications",
        path: "/notifications",
        icon: Bell,
        badge: "notifications",
      },
      {
        label: "Mail",
        path: "/mail",
        icon: Mail,
        permission: "mail.read",
      },
      {
        label: "Settings",
        path: "/settings",
        icon: Settings,
        ownerOnly: true,
        permission: [
          "organization.read",
          "members.read",
          "roles.read",
          "sites.read",
        ],
      },
      {
        label: "Sites & provinces",
        path: "/settings/sites",
        icon: Building2,
        ownerOnly: true,
        permission: "sites.read",
      },
    ],
  },
];

/**
 * The platform staff sidebar. A separate array, not a variant of the one above,
 * because a platform admin is not a member of any workspace — the two have no
 * items in common and merging them would mean guarding every entry.
 */
export const PLATFORM_NAV: NavGroup[] = [
  {
    id: "platform-overview",
    label: "Overview",
    items: [{ label: "Dashboard", path: "/platform", icon: LayoutDashboard }],
  },
  {
    id: "platform-tenants",
    label: "Tenants",
    items: [
      {
        label: "Organizations",
        path: "/platform/organizations",
        icon: Building2,
        permission: "platform.organizations.read",
      },
      {
        label: "Subscriptions",
        path: "/platform/subscriptions",
        icon: Receipt,
        permission: "platform.subscriptions.read",
      },
    ],
  },
  {
    id: "platform-catalogue",
    label: "Catalogue",
    items: [
      {
        label: "Industries",
        path: "/platform/industries",
        icon: Sprout,
        permission: "platform.industries.read",
      },
    ],
  },
  {
    id: "platform-admin",
    label: "Administration",
    items: [
      {
        label: "Contact requests",
        path: "/platform/contact-requests",
        icon: Contact,
        permission: "platform.contact_requests.read",
      },
      {
        label: "Staff",
        path: "/platform/staff",
        icon: Users,
        permission: "platform.users.read",
        platformRole: "platform_super_admin",
      },
      {
        label: "Websites",
        path: "/platform/websites",
        icon: PanelsTopLeft,
        platformRole: "platform_super_admin",
      },
    ],
  },
];

/**
 * Which nav item a URL corresponds to, longest path first.
 *
 * Longest-first matters: `/finance/cash` and `/finance` both prefix-match the
 * cash page, and without ordering the parent would win and highlight the wrong
 * row.
 */
export function activeItemPath(
  pathname: string,
  orgSlug: string,
  groups: NavGroup[] = WORKSPACE_NAV,
): string | null {
  const candidates = groups
    .flatMap((group) => group.items.map((item) => item.path))
    .sort((a, b) => b.length - a.length);

  for (const path of candidates) {
    const full = orgSlug ? `/${orgSlug}${path}` : path;
    if (pathname === full || pathname.startsWith(`${full}/`)) return path;
  }
  return null;
}
