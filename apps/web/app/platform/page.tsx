import type { Metadata } from "next";
import { PlatformDashboard } from "./platform-dashboard";

export const metadata: Metadata = { title: "LiteHubs Owner" };
export default function PlatformPage() {
  return <PlatformDashboard />;
}
