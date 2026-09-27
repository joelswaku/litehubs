export const metadata = { title: "Hors connexion" };

/** The service worker uses this public page only when a fresh navigation has
 * no connection. Previously opened field forms can still keep supported
 * entries on this device and synchronize when the network returns. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6 text-ink">
      <section className="max-w-md rounded-3xl border border-border bg-surface-1 p-7 shadow-xl shadow-black/10">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">LiteHubs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Hors connexion</h1>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">
          La connexion est momentanément indisponible. Les formulaires déjà ouverts pour les œufs, l’aliment, la mortalité et les relevés porcins peuvent conserver leurs saisies sur cet appareil, puis les synchroniser dès le retour du réseau.
        </p>
      </section>
    </main>
  );
}
