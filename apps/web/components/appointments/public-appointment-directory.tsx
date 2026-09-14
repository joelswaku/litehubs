"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { CalendarCheck2, CheckCircle2, Clock3, MailCheck, MapPin } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { get, post } from "@/lib/api";

type PublicSite = {
  organizationSlug: string;
  organizationName: string;
  code: string;
  name: string;
  provinceName: string;
  bookingOpensAt: string;
  bookingClosesAt: string;
};
type Service = { id: string; name: string; description: string | null; durationMinutes: number };
type AvailableSlots = { slots: Array<{ value: string; localTime: string }> };
type SiteDetail = {
  organizationName: string;
  site: { code: string; name: string };
  settings: { bookingOpensAt: string; bookingClosesAt: string; welcomeMessage: string | null };
  services: Service[];
};

const publicUrl = (orgSlug: string, rest: string) =>
  `/public/organizations/${encodeURIComponent(orgSlug)}/appointments/${rest}`;

export function PublicAppointmentDirectory() {
  const [fr, setFr] = useState(true);
  const [siteKey, setSiteKey] = useState("");
  const [requestedSiteKey, setRequestedSiteKey] = useState("");
  const [form, setForm] = useState({ serviceId: "", date: new Date().toISOString().slice(0, 10), visitorName: "", visitorEmail: "", visitorPhone: "", reason: "", scheduledAt: "" });
  const label = (french: string, english: string) => fr ? french : english;

  const sites = useQuery({
    queryKey: ["public-appointment-directory"],
    queryFn: () => get<{ sites: PublicSite[] }>("/public/appointments/sites").then((response) => response.sites),
  });
  const onlyPublicSite = sites.data?.length === 1 ? sites.data[0] : undefined;
  const automaticSiteKey = onlyPublicSite ? `${onlyPublicSite.organizationSlug}:${onlyPublicSite.code}` : "";
  const selectedSiteKey = siteKey || requestedSiteKey || automaticSiteKey;
  const site = (sites.data ?? []).find((item) => `${item.organizationSlug}:${item.code}` === selectedSiteKey);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const org = query.get("org");
    const siteCode = query.get("site");
    if (org && siteCode) setRequestedSiteKey(`${org}:${siteCode}`);
  }, []);
  useEffect(() => {
    if (selectedSiteKey && site && siteKey !== selectedSiteKey) setSiteKey(selectedSiteKey);
  }, [selectedSiteKey, site, siteKey]);

  const detail = useQuery({
    queryKey: ["public-appointment-directory-site", site?.organizationSlug, site?.code],
    enabled: Boolean(site),
    queryFn: () => get<SiteDetail>(publicUrl(site!.organizationSlug, `sites/${site!.code}`)),
  });
  const selectedService = detail.data?.services.find((service) => service.id === form.serviceId);
  const slots = useQuery({
    queryKey: ["public-appointment-slots", site?.organizationSlug, site?.code, form.serviceId, form.date],
    enabled: Boolean(site && form.serviceId && form.date),
    queryFn: () => get<AvailableSlots>(`${publicUrl(site!.organizationSlug, `sites/${site!.code}/slots`)}?date=${encodeURIComponent(form.date)}&serviceId=${encodeURIComponent(form.serviceId)}`),
  });

  useEffect(() => {
    const firstService = detail.data?.services[0];
    if (firstService && !detail.data?.services.some((service) => service.id === form.serviceId)) {
      setForm((value) => ({ ...value, serviceId: firstService.id }));
    }
  }, [detail.data, form.serviceId]);

  const booking = useMutation({
    mutationFn: () => {
      const { date: _date, ...bookingForm } = form;
      return post<any>(publicUrl(site!.organizationSlug, "book"), {
        ...bookingForm,
        siteCode: site!.code,
        visitorEmail: form.visitorEmail || null,
        visitorPhone: form.visitorPhone || null,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = () => {
    booking.reset();
    setForm((value) => ({ ...value, visitorName: "", visitorEmail: "", visitorPhone: "", reason: "", scheduledAt: "" }));
  };

  return <main className="relative isolate min-h-dvh overflow-hidden bg-[#062e29] px-4 py-6 text-ink sm:px-6 sm:py-10">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_8%,rgba(45,212,191,.24),transparent_27%),radial-gradient(circle_at_88%_18%,rgba(56,189,248,.18),transparent_25%),linear-gradient(145deg,#062e29_0%,#083f37_50%,#062c35_100%)]" aria-hidden />
    <div className="pointer-events-none absolute -left-24 bottom-[-12rem] size-[32rem] rounded-full border border-white/10 bg-emerald-300/5 blur-2xl" aria-hidden />
    <div className="pointer-events-none absolute -right-24 top-20 size-[26rem] rounded-full border border-white/10 bg-sky-300/5 blur-2xl" aria-hidden />
    <div className="pointer-events-none absolute inset-0 opacity-[.08] [background-image:linear-gradient(rgba(255,255,255,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.45)_1px,transparent_1px)] [background-size:52px_52px]" aria-hidden />
    <div className="relative z-10 mx-auto max-w-3xl">
      <header className="mb-5 flex items-center justify-between"><a href="/" className="inline-flex items-center gap-2 font-semibold text-ink"><span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink"><CalendarCheck2 className="size-5" /></span>LiteHubs</a><button type="button" className="text-xs font-semibold text-brand" onClick={() => setFr((value) => !value)}>{fr ? "EN" : "FR"}</button></header>
      <Card className="relative isolate overflow-hidden border border-brand/25 bg-[radial-gradient(circle_at_88%_8%,rgba(20,184,166,.14),transparent_24%),radial-gradient(circle_at_8%_100%,rgba(59,130,246,.09),transparent_30%),linear-gradient(145deg,var(--surface-1),var(--surface-2))] shadow-[0_24px_65px_-42px_rgba(6,58,52,.6)]">
        <div className="relative border-b border-white/10 bg-[linear-gradient(115deg,#073c34,#0f766e_68%,#13928a)] px-6 py-7 text-white sm:px-8"><p className="text-xs font-bold tracking-[.14em] text-emerald-100">{label("RENDEZ-VOUS EN LIGNE", "ONLINE APPOINTMENT")}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">{label("Demander un rendez-vous", "Request an appointment")}</h1><p className="mt-2 text-sm leading-6 text-emerald-50">{label("Choisissez le site, le service et l’horaire qui vous conviennent.", "Choose the site, service and time that suit you.")}</p></div>
        <CardContent className="relative bg-surface-1/85 p-5 backdrop-blur-[2px] sm:p-7">
          {booking.data ? <div className="py-8 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-7" /></span><h2 className="mt-4 text-xl font-semibold text-ink">{label("Rendez-vous confirmé", "Appointment confirmed")}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">{label("Votre confirmation a été envoyée par e-mail. Présentez-vous à l’heure choisie.", "Your confirmation was sent by email. Please arrive at your selected time.")}</p>{booking.data?.appointment?.reference ? <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-brand/25 bg-brand/[0.055] px-4 py-3"><p className="text-[11px] font-bold tracking-[.12em] text-ink-secondary">{label("NUMÉRO DE RENDEZ-VOUS", "APPOINTMENT REFERENCE")}</p><p className="mt-1 text-base font-semibold tracking-wide text-brand">{booking.data.appointment.reference}</p></div> : null}<Button className="mt-5" variant="secondary" onClick={reset}>{label("Nouveau rendez-vous", "New appointment")}</Button></div> : sites.isLoading || (site && detail.isLoading) ? <SkeletonCard rows={6} /> : sites.isError || detail.isError ? <ErrorState title={label("Rendez-vous indisponibles", "Appointments unavailable")} description={String((sites.error ?? detail.error as Error)?.message ?? "")} onRetry={() => { void sites.refetch(); void detail.refetch(); }} /> : !(sites.data ?? []).length ? <EmptyState title={label("Aucun site disponible", "No site available")} description={label("Aucune entreprise ne prend actuellement de rendez-vous en ligne.", "No organization is currently accepting online appointments.")} /> : <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); booking.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={label("Entreprise et site", "Organization and site")} required><select className="control h-11" required value={selectedSiteKey} onChange={(event) => { setSiteKey(event.target.value); setForm((value) => ({ ...value, serviceId: "", scheduledAt: "" })); }}><option value="" disabled>{label("Choisissez une entreprise et un site", "Choose an organization and site")}</option>{(sites.data ?? []).map((item) => <option key={`${item.organizationSlug}:${item.code}`} value={`${item.organizationSlug}:${item.code}`}>{item.organizationName} · {item.name} · {item.provinceName}</option>)}</select></Field>
              <Field label={label("Service", "Service")} required><select className="control h-11" required disabled={!site || detail.isLoading || !detail.data?.services.length} value={form.serviceId} onChange={(event) => setForm((value) => ({ ...value, serviceId: event.target.value, scheduledAt: "" }))}><option value="" disabled>{!site ? label("Choisissez d’abord un site", "Choose a site first") : detail.isLoading ? label("Chargement des services…", "Loading services…") : !detail.data?.services.length ? label("Aucun service disponible", "No service available") : label("Choisissez un service", "Choose a service")}</option>{detail.data?.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></Field>
            </div>
            {detail.data ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface-2/45 px-4 py-3 text-sm text-ink-secondary"><span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-brand" />{detail.data.site.name}</span><span className="inline-flex items-center gap-1.5"><Clock3 className="size-4 text-brand" />{detail.data.settings.bookingOpensAt}–{detail.data.settings.bookingClosesAt}</span>{selectedService ? <span className="font-medium text-ink">{selectedService.durationMinutes} {label("min", "min")}</span> : null}</div> : null}
            <div className="grid gap-4 sm:grid-cols-2"><Field label={label("Date", "Date")} required><Input className="h-11" required type="date" min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(event) => setForm((value) => ({ ...value, date: event.target.value, scheduledAt: "" }))} /></Field><Field label={label("Heure disponible", "Available time")} required><select className="control h-11" required disabled={!form.serviceId || slots.isLoading || !(slots.data?.slots.length)} value={form.scheduledAt} onChange={(event) => setForm((value) => ({ ...value, scheduledAt: event.target.value }))}><option value="" disabled>{!form.serviceId ? label("Choisissez un service", "Choose a service") : slots.isLoading ? label("Recherche des créneaux…", "Finding available times…") : !slots.data?.slots.length ? label("Aucun créneau disponible", "No time available") : label("Choisissez une heure", "Choose a time")}</option>{slots.data?.slots.map((slot) => <option key={slot.value} value={slot.value}>{slot.localTime}</option>)}</select></Field></div>
            {slots.isError ? <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">{label("Les créneaux ne peuvent pas être chargés. Réessayez dans un instant.", "Available times could not be loaded. Please try again.")}</p> : <p className="text-xs text-ink-muted">{label("Seuls les créneaux futurs et encore libres sont proposés.", "Only future, still-available time slots are shown.")}</p>}
            <div className="grid gap-4 sm:grid-cols-2"><Field label={label("Nom complet", "Full name")} required><Input className="h-11" required autoComplete="name" value={form.visitorName} onChange={(event) => setForm((value) => ({ ...value, visitorName: event.target.value }))} /></Field><div className="hidden sm:block" /></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="E-mail" required hint={label("Confirmation envoyée à cette adresse.", "Confirmation sent to this address.")}><Input className="h-11" required type="email" autoComplete="email" value={form.visitorEmail} onChange={(event) => setForm((value) => ({ ...value, visitorEmail: event.target.value }))} /></Field><Field label={label("Téléphone", "Phone")} hint={label("Ajoutez un numéro pour recevoir aussi le SMS de confirmation.", "Add a number to also receive the confirmation by SMS.")}><Input className="h-11" autoComplete="tel" value={form.visitorPhone} onChange={(event) => setForm((value) => ({ ...value, visitorPhone: event.target.value }))} /></Field></div>
            <Field label={label("Motif de la visite", "Visit reason")}><Input className="h-11" value={form.reason} placeholder={label("Facultatif", "Optional")} onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} /></Field>
            {detail.data?.settings.welcomeMessage ? <p className="rounded-xl bg-brand/5 px-3 py-2 text-sm text-ink-secondary">{detail.data.settings.welcomeMessage}</p> : null}
            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="flex max-w-md items-start gap-2 text-xs leading-5 text-ink-muted"><MailCheck className="mt-0.5 size-4 shrink-0 text-brand" />{label("Votre e-mail sert uniquement à confirmer ce rendez-vous et vous informer si votre tour approche.", "Your email is used only to confirm this appointment and notify you when your turn approaches.")}</p><Button className="h-11 shrink-0" loading={booking.isPending} disabled={!site || !form.serviceId || !form.scheduledAt}><CalendarCheck2 />{label("Confirmer le rendez-vous", "Confirm appointment")}</Button></div>
          </form>}
        </CardContent>
      </Card>
    </div>
  </main>;
}