import type { Metadata } from "next";
import { RegisterScreen } from "../../../register/register-screen";

export const metadata: Metadata = {
  title: "Créer votre entreprise",
  robots: { index: false, follow: false },
};

export default function StaffCompanyRegistrationPage() {
  return <RegisterScreen />;
}