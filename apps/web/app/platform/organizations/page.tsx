import type { Metadata } from "next";
import { TenantRegistry } from "../platform-dashboard";
export const metadata: Metadata = { title: "Entreprises LiteHubs" };
export default function PlatformOrganizationsPage() {
  return <TenantRegistry />;
}
