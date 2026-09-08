import type { Metadata } from "next";
import { TenantRegistry } from "../platform-dashboard";
export const metadata: Metadata = { title: "Abonnements LiteHubs" };
export default function PlatformSubscriptionsPage() {
  return <TenantRegistry subscriptionsOnly />;
}
