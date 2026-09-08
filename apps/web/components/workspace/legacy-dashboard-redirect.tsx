"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { useSession } from "@/hooks/useAuth";
import { workspaceLandingPathFor } from "@/lib/auth";

export function LegacyDashboardRedirect({ target = "" }: { target?: string }) {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.isSuccess) {
      const organization =
        session.data.activeOrganization ??
        (session.data.organizations.length === 1 ? session.data.organizations[0] : null);
      router.replace(
        organization && target
          ? `/${organization.slug}${target}`
          : workspaceLandingPathFor(session.data),
      );
    }
    if (session.isError) {
      router.replace(`/login?next=${encodeURIComponent(`/dashboard${target}`)}`);
    }
  }, [router, session.data, session.isError, session.isSuccess, target]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface-1 p-8 text-center shadow-xl shadow-slate-950/5 dark:shadow-black/20">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand/12 text-brand">
          <Building2 className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">Ouverture de votre espace</h1>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">Nous vous dirigeons vers le tableau de bord de votre entreprise.</p>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-muted" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Chargement sécurisé…
        </div>
      </section>
    </main>
  );
}