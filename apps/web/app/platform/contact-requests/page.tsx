import type { Metadata } from "next";
import { ContactRequestsPage } from "./contact-requests-page";

export const metadata: Metadata = { title: "Demandes de contact" };

export default function ContactRequestsRoute() {
  return <ContactRequestsPage />;
}
