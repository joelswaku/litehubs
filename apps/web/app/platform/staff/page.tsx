import type { Metadata } from "next";
import { PlatformStaffPage } from "../platform-dashboard";
export const metadata: Metadata = { title: "Personnel LiteHubs" };
export default function PlatformStaffPageRoute() {
  return <PlatformStaffPage />;
}
