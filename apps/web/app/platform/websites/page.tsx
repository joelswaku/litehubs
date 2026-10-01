import type { Metadata } from "next";
import { PlatformWebsites } from "./platform-websites";

export const metadata: Metadata = { title: "Sites web · LiteHubs" };

export default function PlatformWebsitesPage() {
  return <PlatformWebsites />;
}
