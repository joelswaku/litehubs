import type { Metadata } from "next";
import Link from "next/link";
import { CONGO_OMEGA_PUBLIC_ICONS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Page introuvable | Congo Omega",
  robots: { index: false, follow: false },
  ...CONGO_OMEGA_PUBLIC_ICONS,
};

/** A genuine 404 for a retired URL or a typing error on the public domain.
 * This avoids showing a technical LiteHubs availability message to a Congo
 * Omega visitor, and tells search engines that the former page is gone. */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#f7faf8] px-6 py-10 text-[#17352d] sm:px-10 lg:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col justify-center">
        <Link
          href="/"
          className="mb-12 inline-flex w-fit items-center gap-2 text-sm font-semibold tracking-wide text-[#075c4d] transition hover:text-[#043d34]"
        >
          <span aria-hidden="true">←</span>
          Congo Omega
        </Link>
        <p className="mb-4 text-sm font-bold tracking-[0.18em] text-[#b36d13]">ERREUR 404</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-[#143b31] sm:text-6xl">
          Cette page n’existe plus.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[#49645d]">
          Cette adresse appartenait peut-être à notre ancien site. Retrouvez les
          informations actuelles de Congo Omega depuis l’accueil.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-full bg-[#075c4d] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#043d34]"
          >
            Retour à l’accueil
          </Link>
          <Link
            href="/activites"
            className="rounded-full border border-[#a8c1b7] bg-white px-6 py-3 text-sm font-semibold text-[#075c4d] transition hover:border-[#075c4d]"
          >
            Découvrir nos activités
          </Link>
        </div>
      </div>
    </main>
  );
}
