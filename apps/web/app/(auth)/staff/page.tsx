import { Suspense } from "react";
import type { Metadata } from "next";
import { StaffLoginScreen } from "./login/staff-login-screen";

export const metadata: Metadata = {
  title: "Personnel LiteHubs",
  robots: { index: false, follow: false },
};

/** The short, memorable sign-in address for LiteHubs staff. */
export default function StaffLoginPage() {
  return (
    <Suspense fallback={null}>
      <StaffLoginScreen />
    </Suspense>
  );
}
