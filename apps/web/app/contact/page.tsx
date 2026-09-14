import type { Metadata } from "next";
import { INDEXABLE, publicUrl } from "@/lib/seo";
import { ContactPage } from "./contact-page";

const DESCRIPTION =
  "Contactez l’équipe LiteHubs pour une question sur la plateforme, votre accès ou votre organisation.";

export const metadata: Metadata = {
  // "Contact", not "Contact LiteHubs": the root layout's `%s | LiteHubs`
  // template does apply to this segment, so the longer form rendered as
  // "Contact LiteHubs | LiteHubs".
  title: "Contact",
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: {
    type: "website",
    siteName: "LiteHubs",
    url: publicUrl("/contact"),
    title: "Contact | LiteHubs",
    description: DESCRIPTION,
  },
  robots: INDEXABLE,
};

export default function ContactRoute() {
  return <ContactPage />;
}