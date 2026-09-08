import type { Metadata } from "next";
import { OrganizationPickerScreen } from "./organization-picker-screen";
export const metadata: Metadata = { title: "Choisir une entreprise" };
export default function SelectOrganizationPage() {
  return <OrganizationPickerScreen />;
}
