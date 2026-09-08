import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordScreen } from "./reset-password-screen";
export const metadata: Metadata = { title: "Nouveau mot de passe" };
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
