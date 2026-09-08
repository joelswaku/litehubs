import type { Metadata } from "next";
import { StaffLoginScreen } from "./staff-login-screen";
export const metadata: Metadata = { title: "Personnel LiteHubs" };
export default function StaffLoginPage() {
  return <StaffLoginScreen />;
}
