import type { Metadata } from "next";
import { FarmDisplayBoard } from "@/components/displays/farm-display-board";

export const metadata: Metadata = {
  title: "Tableau d’affichage",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FarmDisplayBoard token={token} />;
}
