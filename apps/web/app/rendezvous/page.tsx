import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicAppointmentDirectory } from "@/components/appointments/public-appointment-directory";
import {
  CONGO_OMEGA_PUBLIC_ICONS,
  INDEXABLE,
  isCongoOmegaHost,
  normalizePublicHost,
  publicOriginForHost,
  publicUrl,
} from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = normalizePublicHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const congoOmega = isCongoOmegaHost(host);
  const origin = congoOmega
    ? publicOriginForHost(host)
    : publicUrl("").replace(/\/$/, "");
  const title = congoOmega
    ? "Prendre rendez-vous | Congo Omega"
    : "Prendre rendez-vous | LiteHubs";
  const description = congoOmega
    ? "Demandez un rendez-vous avec l’équipe Congo Omega, choisissez le site, le service et l’horaire qui vous conviennent."
    : "Demandez gratuitement un rendez-vous auprès d’une entreprise ou d’un site disponible sur LiteHubs, sans créer de compte.";
  return {
    title: congoOmega ? { absolute: title } : title,
    description,
    alternates: { canonical: `${origin}/rendezvous` },
    openGraph: {
      type: "website",
      siteName: congoOmega ? "Congo Omega" : "LiteHubs",
      url: `${origin}/rendezvous`,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(congoOmega ? {} : { images: [publicUrl("/opengraph-image")] }),
    },
    robots: INDEXABLE,
    ...(congoOmega ? CONGO_OMEGA_PUBLIC_ICONS : {}),
  };
}

export default function PublicAppointmentRoute() {
  return <PublicAppointmentDirectory />;
}
