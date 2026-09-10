import type { Metadata } from "next";
import { PlatformAccountPage } from "./platform-account-page";

export const metadata: Metadata = { title: "Mon compte LiteHubs" };

export default function PlatformAccountRoute() {
  return <PlatformAccountPage />;
}
