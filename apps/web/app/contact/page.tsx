import type { Metadata } from "next";
import { ContactPage } from "./contact-page";

export const metadata: Metadata = {
  title: "Contact LiteHubs",
  description: "Contactez l’administration LiteHubs.",
  robots: { index: true, follow: true },
};

export default function ContactRoute() {
  return <ContactPage />;
}
