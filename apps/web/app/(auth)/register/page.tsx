import type { Metadata } from "next";
import { RegisterScreen } from "./register-screen";

export const metadata: Metadata = { title: "Créer votre entreprise" };
export default function RegisterPage() {
  return <RegisterScreen />;
}
