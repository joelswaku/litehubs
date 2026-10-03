"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { get } from "@/lib/api";

type Onboarding = {
  organizationName: string;
  candidate: { fullName: string; email: string; phone: string };
  job: { title: string; siteName: string };
  expiresAt: string;
  profile: Record<string, string | null>;
};

const endpoint = (orgSlug: string, token: string) =>
  `/public/organizations/${encodeURIComponent(orgSlug)}/careers/onboarding/${encodeURIComponent(token)}`;

const initialForm = {
  lastName: "",
  postName: "",
  firstName: "",
  dateOfBirth: "",
  placeOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  addressCity: "",
  addressRegion: "",
  addressPostalCode: "",
  addressCountry: "République démocratique du Congo",
  identityDocumentType: "national_id",
  identityDocumentNumber: "",
  socialSecurityNumber: "",
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
  consent: false,
};

export function PublicOnboardingPage({
  orgSlug,
  token,
}: {
  orgSlug: string;
  token: string;
}) {
  const [form, setForm] = useState(initialForm);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [identityDocument, setIdentityDocument] = useState<File | null>(null);
  const [done, setDone] = useState(false);
  const onboarding = useQuery({
    queryKey: ["public-career-onboarding", orgSlug, token],
    queryFn: () => get<{ onboarding: Onboarding }>(endpoint(orgSlug, token)),
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    const profile = onboarding.data?.onboarding.profile;
    if (!profile) return;
    setForm((current) => ({
      ...current,
      lastName: profile.lastName ?? current.lastName,
      postName: profile.postName ?? current.postName,
      firstName: profile.firstName ?? current.firstName,
      dateOfBirth: profile.dateOfBirth ?? current.dateOfBirth,
      placeOfBirth: profile.placeOfBirth ?? current.placeOfBirth,
      addressLine1: profile.addressLine1 ?? current.addressLine1,
      addressLine2: profile.addressLine2 ?? current.addressLine2,
      addressCity: profile.addressCity ?? current.addressCity,
      addressRegion: profile.addressRegion ?? current.addressRegion,
      addressPostalCode: profile.addressPostalCode ?? current.addressPostalCode,
      addressCountry: profile.addressCountry ?? current.addressCountry,
      identityDocumentType:
        profile.identityDocumentType ?? current.identityDocumentType,
      identityDocumentNumber:
        profile.identityDocumentNumber ?? current.identityDocumentNumber,
      socialSecurityNumber: profile.socialSecurityNumber ?? current.socialSecurityNumber,
      emergencyContactName:
        profile.emergencyContactName ?? current.emergencyContactName,
      emergencyContactRelationship:
        profile.emergencyContactRelationship ?? current.emergencyContactRelationship,
      emergencyContactPhone:
        profile.emergencyContactPhone ?? current.emergencyContactPhone,
    }));
  }, [onboarding.data]);
  const submit = useMutation({
    mutationFn: async () => {
      if (!portrait) throw new Error("Ajoutez votre photo portrait.");
      if (!identityDocument)
        throw new Error("Ajoutez votre pièce d’identité ou passeport.");
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === "consent") data.append(key, value ? "true" : "");
        else if (value) data.append(key, String(value));
      });
      data.append("portrait", portrait);
      data.append("identityDocument", identityDocument);
      const response = await fetch(`/api/v1${endpoint(orgSlug, token)}`, {
        method: "POST",
        body: data,
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message ??
            "Impossible d’envoyer votre fiche d’intégration.",
        );
      return body;
    },
    onSuccess: () => setDone(true),
    onError: (error: Error) => toast.error(error.message),
  });
  const record = onboarding.data?.onboarding;
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_12%_-10%,rgba(22,163,74,.16),transparent_37%),radial-gradient(circle_at_95%_8%,rgba(37,99,235,.13),transparent_31%),var(--color-page)] px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={`/careers/${orgSlug}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink transition hover:text-brand"
          >
            <ArrowLeft className="size-4" />
            Carrières
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-brand shadow-sm">
            <LockKeyhole className="size-3.5" /> Fiche privée et sécurisée
          </span>
        </header>
        {onboarding.isLoading ? (
          <div className="rounded-3xl border border-border bg-surface-1 p-7 shadow-xl"><SkeletonCard rows={10} /></div>
        ) : onboarding.isError ? (
          <div className="rounded-3xl border border-border bg-surface-1 p-7 shadow-xl"><ErrorState title="Cette fiche n’est plus disponible" description="Le lien est personnel, expire après 21 jours et ne peut être utilisé qu’une fois. Demandez à l’équipe de recrutement de vous en envoyer un nouveau si nécessaire." onRetry={() => void onboarding.refetch()} /></div>
        ) : done ? (
          <section className="rounded-3xl border border-emerald-500/25 bg-surface-1 p-8 text-center shadow-xl sm:p-12">
            <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-9" /></span>
            <h1 className="mt-5 text-2xl font-semibold text-ink">Votre fiche d’intégration est reçue.</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink-secondary">Merci. L’équipe RH de {record?.organizationName ?? "l’entreprise"} vérifie vos informations et préparera votre dossier d’employé. Vos documents ne sont pas publics.</p>
          </section>
        ) : record ? (
          <section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_24px_70px_-45px_rgb(15_23_42_/_.75)]">
            <div className="bg-[radial-gradient(circle_at_82%_-30%,rgba(134,239,172,.35),transparent_43%),linear-gradient(125deg,#123d2a,#166534)] px-6 py-8 text-white sm:px-9 sm:py-10">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.14em]"><UserRoundCheck className="size-3.5" /> INTÉGRATION</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Bienvenue chez {record.organizationName}.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50">Votre offre concerne le poste <strong>{record.job.title}</strong> · {record.job.siteName}. Complétez cette fiche afin que l’équipe RH puisse préparer votre dossier avec exactitude.</p>
              <p className="mt-4 text-xs text-emerald-100/90">Lien valable jusqu’au {new Date(record.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}. Ne le partagez pas.</p>
            </div>
            <form className="space-y-7 p-5 sm:p-8" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
              <InfoBox />
              <Section title="Identité officielle" description="Saisissez les informations exactement comme elles apparaissent sur votre pièce d’identité.">
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField label="Nom" value={form.lastName} onChange={(value) => set("lastName", value)} required autoComplete="family-name" />
                  <TextField label="Post-nom" value={form.postName} onChange={(value) => set("postName", value)} required />
                  <TextField label="Prénom" value={form.firstName} onChange={(value) => set("firstName", value)} required autoComplete="given-name" />
                  <TextField label="Date de naissance" type="date" value={form.dateOfBirth} onChange={(value) => set("dateOfBirth", value)} required />
                  <TextField label="Lieu de naissance" value={form.placeOfBirth} onChange={(value) => set("placeOfBirth", value)} required />
                  <Field label="Type de pièce" required><select className="h-10 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink" value={form.identityDocumentType} onChange={(event) => set("identityDocumentType", event.target.value)}><option value="national_id">Carte d’identité</option><option value="passport">Passeport</option><option value="voter_card">Carte d’électeur</option><option value="driving_licence">Permis de conduire</option><option value="other">Autre pièce</option></select></Field>
                  <TextField label="Numéro de pièce (si disponible)" value={form.identityDocumentNumber} onChange={(value) => set("identityDocumentNumber", value)} />
                  <TextField label="N° INSS / NSS (si disponible)" value={form.socialSecurityNumber} onChange={(value) => set("socialSecurityNumber", value)} />
                </div>
              </Section>
              <Section title="Adresse résidentielle" description="Cette adresse personnelle ne modifie ni votre site de travail ni votre affectation.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Avenue, rue, parcelle ou village" value={form.addressLine1} onChange={(value) => set("addressLine1", value)} required className="sm:col-span-2" autoComplete="street-address" />
                  <TextField label="Quartier / commune / complément" value={form.addressLine2} onChange={(value) => set("addressLine2", value)} />
                  <TextField label="Ville / territoire" value={form.addressCity} onChange={(value) => set("addressCity", value)} required autoComplete="address-level2" />
                  <TextField label="Province / région" value={form.addressRegion} onChange={(value) => set("addressRegion", value)} required autoComplete="address-level1" />
                  <TextField label="Code postal (si disponible)" value={form.addressPostalCode} onChange={(value) => set("addressPostalCode", value)} autoComplete="postal-code" />
                  <TextField label="Pays" value={form.addressCountry} onChange={(value) => set("addressCountry", value)} required autoComplete="country-name" />
                </div>
              </Section>
              <Section title="Contact d’urgence" description="La personne à contacter uniquement en cas d’urgence liée au travail.">
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField label="Nom complet" value={form.emergencyContactName} onChange={(value) => set("emergencyContactName", value)} required />
                  <TextField label="Lien avec vous (facultatif)" value={form.emergencyContactRelationship} onChange={(value) => set("emergencyContactRelationship", value)} />
                  <Field label="Téléphone" required><PhoneInput required fr value={form.emergencyContactPhone} onChange={(event) => set("emergencyContactPhone", event.target.value)} onNormalizedChange={(value) => set("emergencyContactPhone", value)} /></Field>
                </div>
              </Section>
              <Section title="Photo et pièces privées" description="Ces fichiers seront classés dans votre dossier RH confidentiel. Ils ne seront jamais publiés sur le site web.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FileField label="Photo portrait récente" hint="JPEG, PNG ou WebP · obligatoire" accept="image/jpeg,image/png,image/webp" file={portrait} onChange={setPortrait} />
                  <FileField label="Pièce d’identité ou passeport" hint="PDF, JPEG, PNG ou WebP · obligatoire" accept="application/pdf,image/jpeg,image/png,image/webp" file={identityDocument} onChange={setIdentityDocument} />
                </div>
              </Section>
              <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-xs leading-5 ${form.consent ? "border-brand/35 bg-brand/[.05] text-ink" : "border-border bg-surface-2/40 text-ink-secondary"}`}><input required type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} /><span>Je confirme que ces informations sont exactes et j’autorise Congo Omega à les utiliser uniquement pour préparer mon dossier d’emploi et remplir ses obligations administratives.</span></label>
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5"><Button loading={submit.isPending} className="h-11"><ShieldCheck className="size-4" />Envoyer ma fiche d’intégration</Button></div>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function InfoBox() {
  return <div className="flex gap-3 rounded-2xl border border-brand/20 bg-brand/[.045] p-4 text-sm leading-6 text-ink-secondary"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><LockKeyhole className="size-4" /></span><p><strong className="text-ink">Vos données restent privées.</strong> Cette fiche ne donne aucun accès à LiteHubs et ne remplace pas votre future invitation de connexion. Elle sert uniquement à finaliser votre dossier RH.</p></div>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface-1 p-4 sm:p-5"><h2 className="font-semibold text-ink">{title}</h2><p className="mt-1 text-xs leading-5 text-ink-secondary">{description}</p><div className="mt-4">{children}</div></section>;
}

function TextField({ label, value, onChange, required, type = "text", className, autoComplete }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; className?: string; autoComplete?: string }) {
  return <Field label={label} required={required} className={className}><Input required={required} type={type} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function FileField({ label, hint, accept, file, onChange }: { label: string; hint: string; accept: string; file: File | null; onChange: (file: File | null) => void }) {
  return <Field label={label} required hint={hint}><Input required type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />{file ? <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand"><FileUp className="size-3.5" />{file.name}</p> : null}</Field>;
}
