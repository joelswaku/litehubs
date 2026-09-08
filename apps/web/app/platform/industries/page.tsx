import type { Metadata } from "next";
import { IndustryCatalogue } from "../platform-dashboard";
export const metadata: Metadata = { title: "Secteurs LiteHubs" };
export default function PlatformIndustriesPage() {
  return <IndustryCatalogue />;
}
