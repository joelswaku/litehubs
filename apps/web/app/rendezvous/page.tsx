import type { Metadata } from "next";
import { PublicAppointmentDirectory } from "@/components/appointments/public-appointment-directory";
import { INDEXABLE, publicUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Prendre rendez-vous",
  description: "Demandez gratuitement un rendez-vous auprès d’une entreprise ou d’un site disponible sur LiteHubs, sans créer de compte.",
  alternates: { canonical: "/rendezvous" },
  openGraph: {
    type: "website",
    siteName: "LiteHubs",
    url: publicUrl("/rendezvous"),
    title: "Prendre rendez-vous | LiteHubs",
    description: "Choisissez une entreprise, un site, un service et une heure. Aucun compte LiteHubs n’est nécessaire.",
  },
  robots: INDEXABLE,
};

export default function PublicAppointmentRoute() {
  return <PublicAppointmentDirectory />;
}
