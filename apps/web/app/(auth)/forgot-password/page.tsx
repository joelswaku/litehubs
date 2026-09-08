import type { Metadata } from "next";
import { ForgotPasswordScreen } from "./forgot-password-screen";
export const metadata: Metadata = { title: "Réinitialiser le mot de passe" };
export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
