import type { Metadata } from "next";
import { LandingPage } from "./landing-page";

export const metadata: Metadata = {
  title: "Pilotez votre entreprise",
  description:
    "LiteHubs réunit les équipes, opérations, projets et décisions dans un espace sécurisé.",
  robots: { index: true, follow: true },
};

export default function RootPage() {
  return <LandingPage />;
}