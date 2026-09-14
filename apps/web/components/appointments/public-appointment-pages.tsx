"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck2, CheckCircle2, Loader2, MonitorPlay, QrCode, UsersRound, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, post } from "@/lib/api";
import { API_PREFIX } from "@/lib/constants";

type Site = { code: string; name: string; provinceName: string; bookingOpensAt: string; bookingClosesAt: string; organizationName: string };
type Course = { id: string; name: string; description: string | null; durationMinutes: number };
type Detail = { organizationName: string; site: { code: string; name: string }; settings: { bookingOpensAt: string; bookingClosesAt: string; welcomeMessage: string | null }; services: Course[] };
type AvailableSlots = { slots: Array<{ value: string; localTime: string }> };
const publicUrl = (org: string, rest: string) => `/public/organizations/${org}/appointments/${rest}`;
const label = (fr: boolean, a: string, b: string) => fr ? a : b;
const displayDeskName = (name: string | null | undefined, fr: boolean) => {
  const value = name?.trim();
  return !value || /^(desk|guichet)$/i.test(value) ? label(fr, "Guichet 1", "Desk 1") : value;
};

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-[radial-gradient(circle_at_50%_-10%,rgba(20,184,166,.16),transparent_40%),var(--color-page)] px-4 py-7 sm:py-10"><div className="mx-auto max-w-3xl">{children}</div></main>;
}

export function PublicBookingPage({ orgSlug }: { orgSlug: string }) {
  const [fr, setFr] = useState(true);
  const [siteCode, setSiteCode] = useState("");
  const [form, setForm] = useState({ serviceId: "", date: new Date().toISOString().slice(0, 10), visitorName: "", visitorEmail: "", visitorPhone: "", reason: "", scheduledAt: "" });
  useEffect(() => { const value = new URLSearchParams(window.location.search).get("site"); if (value) setSiteCode(value); }, []);
  const sites = useQuery({ queryKey: ["public-appointment-sites", orgSlug], queryFn: () => get<{ sites: Site[] }>(publicUrl(orgSlug, "sites")).then((data) => data.sites) });
  const detail = useQuery({ queryKey: ["public-appointment-site", orgSlug, siteCode], enabled: Boolean(siteCode), queryFn: () => get<Detail>(publicUrl(orgSlug, `sites/${siteCode}`)) });
  const slots = useQuery({ queryKey: ["public-appointment-slots", orgSlug, siteCode, form.serviceId, form.date], enabled: Boolean(siteCode && form.serviceId && form.date), queryFn: () => get<AvailableSlots>(`${publicUrl(orgSlug, `sites/${siteCode}/slots`)}?date=${encodeURIComponent(form.date)}&serviceId=${encodeURIComponent(form.serviceId)}`) });
  const booking = useMutation({
    mutationFn: () => post<any>(publicUrl(orgSlug, "book"), { ...form, siteCode, preferredLanguage: fr ? "fr" : "en", visitorEmail: form.visitorEmail || null, visitorPhone: form.visitorPhone || null, scheduledAt: form.scheduledAt }),
    onError: (error: Error) => toast.error(error.message),
  });
  const result = booking.data;
  return <PublicShell>
    <header className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2 font-semibold text-ink"><span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink"><CalendarCheck2 className="size-5" /></span> LiteHubs</div><button type="button" className="text-xs font-semibold text-brand" onClick={() => setFr((value) => !value)}>{fr ? "EN" : "FR"}</button></header>
    <Card className="overflow-hidden shadow-[0_20px_65px_-45px_rgba(15,23,42,.8)]"><div className="bg-[linear-gradient(125deg,#0b3b31,#0f766e)] px-6 py-8 text-white"><p className="text-xs font-bold tracking-wider text-emerald-100">{label(fr, "RÉSERVATION EN LIGNE", "ONLINE BOOKING")}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">{detail.data?.organizationName ?? sites.data?.[0]?.organizationName ?? "LiteHubs"}</h1><p className="mt-2 text-sm text-emerald-50">{label(fr, "Choisissez un site, un service et une heure. Votre demande reste privée.", "Choose a site, service and time. Your request stays private.")}</p></div>
      <CardContent className="p-5 sm:p-7">{result ? <div className="py-5 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-7" /></span><h2 className="mt-4 text-xl font-semibold text-ink">{label(fr, "Rendez-vous confirmé", "Appointment confirmed")}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">{label(fr, "Votre rendez-vous a été enregistré. Présentez-vous à l’accueil du site à l’heure choisie.", "Your appointment has been registered. Please arrive at the site reception at your selected time.")}</p><Button className="mt-5" variant="secondary" onClick={() => { booking.reset(); setForm({ serviceId: "", date: new Date().toISOString().slice(0, 10), visitorName: "", visitorEmail: "", visitorPhone: "", reason: "", scheduledAt: "" }); }}>{label(fr, "Prendre un autre rendez-vous", "Book another appointment")}</Button></div> : sites.isLoading || (siteCode && detail.isLoading) ? <SkeletonCard rows={6} /> : sites.isError || detail.isError ? <ErrorState title={label(fr, "Réservation indisponible", "Booking unavailable")} description={String((sites.error ?? detail.error as Error)?.message ?? "")} onRetry={() => { void sites.refetch(); void detail.refetch(); }} /> : !sites.data?.length ? <EmptyState title={label(fr, "Aucun site ne prend de rendez-vous", "No site is accepting bookings")} description={label(fr, "Réessayez plus tard ou contactez directement l’entreprise.", "Try again later or contact the organization directly.")} /> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); booking.mutate(); }}>
        <Field label={label(fr, "Site", "Site")} required><select className="control" required value={siteCode} onChange={(event) => { setSiteCode(event.target.value); setForm((state) => ({ ...state, serviceId: "", scheduledAt: "" })); }}><option value="">—</option>{sites.data.map((site) => <option key={site.code} value={site.code}>{site.name} · {site.provinceName}</option>)}</select></Field>
        <Field label={label(fr, "Service", "Service")} required><select className="control" required disabled={!detail.data} value={form.serviceId} onChange={(event) => setForm((state) => ({ ...state, serviceId: event.target.value, scheduledAt: "" }))}><option value="">—</option>{detail.data?.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></Field>
        <Field label={label(fr, "Date", "Date")} required><Input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(event) => setForm((state) => ({ ...state, date: event.target.value, scheduledAt: "" }))} /></Field>
        <Field label={label(fr, "Heure disponible", "Available time")} required><select className="control" required disabled={!form.serviceId || slots.isLoading || !(slots.data?.slots.length)} value={form.scheduledAt} onChange={(event) => setForm((state) => ({ ...state, scheduledAt: event.target.value }))}><option value="" disabled>{!form.serviceId ? label(fr, "Choisissez un service", "Choose a service") : slots.isLoading ? label(fr, "Recherche des créneaux…", "Finding available times…") : !slots.data?.slots.length ? label(fr, "Aucun créneau disponible", "No time available") : label(fr, "Choisissez une heure", "Choose a time")}</option>{slots.data?.slots.map((slot) => <option key={slot.value} value={slot.value}>{slot.localTime}</option>)}</select></Field>
        <Field label={label(fr, "Nom complet", "Full name")} required><Input required value={form.visitorName} onChange={(event) => setForm((state) => ({ ...state, visitorName: event.target.value }))} /></Field>
        <Field label="E-mail" required hint={label(fr, "Indiquez un e-mail pour recevoir la confirmation et l’appel de votre numéro.", "Enter an email to receive confirmation and queue-call updates.")}><Input required type="email" value={form.visitorEmail} onChange={(event) => setForm((state) => ({ ...state, visitorEmail: event.target.value }))} /></Field>
        <Field label={label(fr, "Téléphone", "Phone")} hint={label(fr, "Renseignez au moins un e-mail ou téléphone.", "Enter at least an email or phone number.")}><Input value={form.visitorPhone} onChange={(event) => setForm((state) => ({ ...state, visitorPhone: event.target.value }))} /></Field>
        <Field className="sm:col-span-2" label={label(fr, "Motif de la visite (facultatif)", "Visit reason (optional)")}><Textarea value={form.reason} onChange={(event) => setForm((state) => ({ ...state, reason: event.target.value }))} /></Field>
        {detail.data?.settings.welcomeMessage ? <p className="sm:col-span-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-secondary">{detail.data.settings.welcomeMessage}</p> : null}
        <div className="sm:col-span-2 flex justify-end"><Button loading={booking.isPending}><CalendarCheck2 />{label(fr, "Confirmer le rendez-vous", "Confirm appointment")}</Button></div>
      </form>}</CardContent></Card>
  </PublicShell>;
}

export function PublicCheckInPage({ orgSlug, siteCode }: { orgSlug: string; siteCode: string }) {
  const [fr, setFr] = useState(true);
  const [token, setToken] = useState("");
  const [form, setForm] = useState({ serviceId: "", visitorName: "", visitorEmail: "", visitorPhone: "", reason: "" });
  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);
  const detail = useQuery({ queryKey: ["public-qr-site", orgSlug, siteCode], enabled: Boolean(token), queryFn: () => get<Detail>(publicUrl(orgSlug, `sites/${siteCode}?mode=checkin`)) });
  const checkIn = useMutation({ mutationFn: () => post<any>(publicUrl(orgSlug, `sites/${siteCode}/check-in`), { ...form, token, preferredLanguage: fr ? "fr" : "en", visitorEmail: form.visitorEmail || null, visitorPhone: form.visitorPhone || null }), onError: (error: Error) => toast.error(error.message) });
  const done = checkIn.data;
  return <PublicShell><header className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2 font-semibold text-ink"><span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink"><QrCode className="size-5" /></span> LiteHubs</div><button type="button" className="text-xs font-semibold text-brand" onClick={() => setFr((value) => !value)}>{fr ? "EN" : "FR"}</button></header><Card className="overflow-hidden"><div className="bg-[linear-gradient(125deg,#0b3b31,#0f766e)] px-6 py-8 text-white"><p className="text-xs font-bold tracking-wider text-emerald-100">{label(fr, "ARRIVÉE SANS CONTACT", "CONTACTLESS CHECK-IN")}</p><h1 className="mt-3 text-3xl font-semibold">{detail.data?.site.name ?? label(fr, "Enregistrement d’arrivée", "Check in")}</h1><p className="mt-2 text-sm text-emerald-50">{label(fr, "Saisissez vos informations pour recevoir votre numéro de file.", "Enter your details to receive your queue ticket.")}</p></div><CardContent className="p-5 sm:p-7">{done ? <div className="py-5 text-center"><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand/10 text-brand"><UsersRound className="size-8" /></span><p className="mt-4 text-sm text-ink-secondary">{label(fr, "Votre numéro de file", "Your queue ticket")}</p><p className="mt-1 text-5xl font-bold tracking-[-.06em] text-ink">#{done.ticket?.number}</p><p className="mt-4 text-sm text-ink-secondary">{done.welcomeMessage ?? label(fr, "Veuillez attendre l’appel de votre numéro.", "Please wait for your ticket to be called.")}</p><p className="mx-auto mt-3 max-w-md rounded-xl bg-brand/5 px-3 py-2 text-xs leading-5 text-ink-secondary">{done.confirmationChannel === "email" ? label(fr, "La confirmation est envoyée par e-mail. Nous vous écrirons lorsque votre numéro sera appelé.", "Your confirmation was emailed. We will email you when your ticket is called.") : label(fr, "Gardez ce numéro. L’accueil l’appellera à l’écran lorsqu’il sera prêt.", "Keep this ticket. Reception will call it on the display when ready.")}</p></div> : !token ? <EmptyState title={label(fr, "Lien QR incomplet", "Incomplete QR link")} description={label(fr, "Scannez de nouveau le QR affiché par le site.", "Scan the QR displayed by the site again.")} /> : detail.isLoading ? <SkeletonCard rows={6} /> : detail.isError ? <ErrorState title={label(fr, "Arrivée indisponible", "Check-in unavailable")} description={(detail.error as Error).message} onRetry={() => void detail.refetch()} /> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); checkIn.mutate(); }}><Field label={label(fr, "Service", "Service")} required><select className="control" required value={form.serviceId} onChange={(event) => setForm((state) => ({ ...state, serviceId: event.target.value }))}><option value="">—</option>{detail.data?.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><div className="hidden sm:block" /><Field label={label(fr, "Nom complet", "Full name")} required><Input required value={form.visitorName} onChange={(event) => setForm((state) => ({ ...state, visitorName: event.target.value }))} /></Field><Field label="E-mail" required hint={label(fr, "Indiquez un e-mail pour recevoir la confirmation et l’appel de votre numéro.", "Enter an email to receive confirmation and queue-call updates.")}><Input required type="email" value={form.visitorEmail} onChange={(event) => setForm((state) => ({ ...state, visitorEmail: event.target.value }))} /></Field><Field label={label(fr, "Téléphone", "Phone")}><Input value={form.visitorPhone} onChange={(event) => setForm((state) => ({ ...state, visitorPhone: event.target.value }))} /></Field><Field label={label(fr, "Motif de votre rendez-vous", "Reason for your visit")} required><Textarea required rows={3} value={form.reason} onChange={(event) => setForm((state) => ({ ...state, reason: event.target.value }))} /></Field><div className="sm:col-span-2 flex justify-end"><Button loading={checkIn.isPending}><QrCode />{label(fr, "Prendre mon numéro", "Get my ticket")}</Button></div></form>}</CardContent></Card></PublicShell>;
}

function announceQueueTicket(ticket: number, deskName: string | null | undefined, message: string | null | undefined, fr: boolean) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const destination = deskName
    ? (fr ? `au ${displayDeskName(deskName, fr)}` : `at ${displayDeskName(deskName, fr)}`)
    : (fr ? "à l’accueil" : "at reception");
  const defaultMessage = fr
    ? `Numéro ${ticket}, veuillez vous présenter ${destination}.`
    : `Ticket number ${ticket}, please come to reception ${destination}.`;
  const announcement = message?.trim()
    ? (fr ? `Numéro ${ticket}. ${message.trim()}` : `Ticket number ${ticket}. ${message.trim()}`)
    : defaultMessage;
  const utterance = new SpeechSynthesisUtterance(announcement);
  utterance.lang = fr ? "fr-FR" : "en-US";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
function playQueueCallChime(context: AudioContext) {
  const start = context.currentTime;
  [0, 0.26].forEach((offset, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(index === 0 ? 740 : 988, start + offset);
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.24);
  });
}

export function PublicQueuePage({ orgSlug, siteCode }: { orgSlug: string; siteCode: string }) {
  const [fr, setFr] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const announcedCalls = useRef(new Set<string>());
  const hasSeenQueueState = useRef(false);
  const queue = useQuery({
    queryKey: ["public-queue", orgSlug, siteCode],
    queryFn: () => get<any>(publicUrl(orgSlug, `sites/${siteCode}/queue`)),
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const waiting = queue.data?.waiting ?? [];
  const activeCalls = queue.data?.nowServing ?? [];
  const activeCallKey = activeCalls.map((call: any) => `${call.ticket}:${call.deskName ?? ""}`).sort().join("|");
  const tvNotEnabled = queue.error instanceof ApiError && queue.error.status === 404;
  const unavailableTitle = tvNotEnabled
    ? label(fr, "Écran TV non activé pour ce site", "TV display is not enabled for this site")
    : label(fr, "File temporairement indisponible", "Queue temporarily unavailable");
  const unavailableDescription = tvNotEnabled
    ? label(fr, "Dans Rendez-vous → Configurer, activez Écran de file TV puis enregistrez.", "In Appointments → Configure, enable Queue TV display and save.")
    : label(fr, "Vérifiez la connexion puis réessayez.", "Check the connection and try again.");

  useEffect(() => {
    const hasPreviousSnapshot = hasSeenQueueState.current;
    hasSeenQueueState.current = true;
    const freshCalls = activeCalls.filter((call: any) => {
      const key = `${call.ticket}:${call.deskName ?? ""}`;
      if (announcedCalls.current.has(key)) return false;
      announcedCalls.current.add(key);
      return true;
    });
    if (!soundEnabled || !hasPreviousSnapshot || !freshCalls.length || !audioContext.current) return;
    void audioContext.current.resume().then(() => {
      freshCalls.forEach((call: any, index: number) => {
        window.setTimeout(() => {
          if (!audioContext.current) return;
          playQueueCallChime(audioContext.current);
          announceQueueTicket(Number(call.ticket), call.deskName, call.message, fr);
        }, index * 2_800);
      });
    }).catch(() => undefined);
  }, [activeCallKey, fr, soundEnabled]);
  const toggleSound = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    audioContext.current ??= new AudioContextConstructor();
    await audioContext.current.resume();
    setSoundEnabled(true);
    playQueueCallChime(audioContext.current);
    activeCalls.forEach((call: any, index: number) => {
      announcedCalls.current.add(`${call.ticket}:${call.deskName ?? ""}`);
      window.setTimeout(() => announceQueueTicket(Number(call.ticket), call.deskName, call.message, fr), index * 2_800);
    });
  };

  const hasMultipleActiveCalls = activeCalls.length > 1;
  const isQueueIdle = !activeCalls.length && !waiting.length;
  const idleVideoId = queue.data?.idleDisplay?.videoId;
  const hasIdleVideo = Boolean(idleVideoId);
  const idleVideoUrl = hasIdleVideo
    ? API_PREFIX + publicUrl(orgSlug, "sites/" + siteCode + "/idle-video") + "?v=" + encodeURIComponent(String(idleVideoId))
    : null;
  const idleTitle = queue.data?.idleDisplay?.title?.trim() || (hasIdleVideo ? "" : label(fr, "Bienvenue", "Welcome"));
  const idleMessage = queue.data?.idleDisplay?.message?.trim() || (hasIdleVideo ? "" : label(fr, "Nous sommes prêts à vous accueillir. Présentez-vous au guichet ou suivez les instructions du site.", "We are ready to welcome you. Please come to reception or follow the site instructions."));

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[radial-gradient(circle_at_16%_0%,#0f766e_0%,#073a31_38%,#062c25_78%)] px-4 py-4 text-white sm:px-7 sm:py-6 2xl:px-10">
      <section className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[1920px] flex-col sm:min-h-[calc(100dvh-3rem)]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100/15 pb-4 sm:mb-7 sm:pb-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-300 text-emerald-950 shadow-lg shadow-emerald-950/20 sm:size-14"><MonitorPlay className="size-6 sm:size-7" /></span>
            <div className="min-w-0">
              <p className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{queue.data?.organizationName ?? "LiteHubs"}</p>
              <p className="mt-0.5 truncate text-sm font-medium text-emerald-100 sm:text-base">{queue.data?.siteName ?? "…"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => void toggleSound()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-100/30 bg-white/[0.04] px-3 text-xs font-bold text-emerald-50 transition hover:bg-white/10 sm:px-4 sm:text-sm" aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}{soundEnabled ? label(fr, "Son activé", "Sound on") : label(fr, "Activer le son", "Enable sound")}</button>
            <button type="button" onClick={() => setFr((value) => !value)} className="min-h-10 rounded-xl border border-emerald-100/30 bg-white/[0.04] px-3 text-xs font-bold tracking-[.12em] text-emerald-50 transition hover:bg-white/10 sm:px-4 sm:text-sm" aria-label={label(fr, "Afficher en anglais", "Show in French")}>{fr ? "EN" : "FR"}</button>
            <p className="hidden text-base font-semibold tabular-nums text-emerald-100 sm:block">{new Date().toLocaleTimeString(fr ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </header>
        {queue.isLoading ? <div className="grid flex-1 place-items-center"><Loader2 className="size-10 animate-spin text-emerald-200" /></div> : queue.isError ? <div className="grid flex-1 place-items-center text-center"><div><p className="text-2xl font-semibold">{unavailableTitle}</p><p className="mt-3 max-w-md text-base leading-7 text-emerald-100">{unavailableDescription}</p><Button type="button" variant="secondary" className="mt-6" onClick={() => void queue.refetch()}>{label(fr, "Réessayer", "Try again")}</Button></div></div> : <>
          {isQueueIdle ? <section className="relative grid flex-1 place-items-center overflow-hidden rounded-[2rem] border border-emerald-100/20 bg-[linear-gradient(135deg,rgba(6,78,59,.92),rgba(5,46,38,.96))] px-6 py-12 text-center shadow-[0_24px_70px_-36px_rgba(0,0,0,.72)] sm:rounded-[2.5rem] sm:px-12">{idleVideoUrl ? <video key={idleVideoUrl} src={idleVideoUrl} autoPlay muted loop playsInline preload="auto" className="absolute inset-0 size-full object-cover" aria-label={label(fr, "Vidéo d’accueil", "Welcome video")} /> : null}{idleVideoUrl ? <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,44,34,.26),rgba(2,18,15,.46))]" /> : null}<div className="absolute -left-24 -top-24 size-80 rounded-full bg-emerald-300/10 blur-3xl motion-safe:animate-pulse" /><div className="absolute -bottom-28 -right-20 size-96 rounded-full bg-teal-300/10 blur-3xl motion-safe:animate-pulse" /><div className={idleVideoUrl ? "relative max-w-4xl rounded-3xl bg-slate-950/25 px-8 py-7 backdrop-blur-[2px]" : "relative max-w-4xl"}>{!idleVideoUrl ? <span className="mx-auto grid size-20 place-items-center rounded-[1.75rem] border border-emerald-100/30 bg-white/10 text-emerald-100 shadow-xl sm:size-24"><CalendarCheck2 className="size-10 sm:size-12" /></span> : null}{idleTitle ? <p className="mt-7 text-sm font-extrabold tracking-[.2em] text-emerald-200 sm:text-base">{label(fr, "ACCUEIL", "WELCOME")}</p> : null}{idleTitle ? <h1 className="mt-4 text-[clamp(2.75rem,6vw,7rem)] font-black leading-[.98] tracking-tight text-white">{idleTitle}</h1> : null}{idleMessage ? <p className="mx-auto mt-6 max-w-3xl text-[clamp(1.15rem,2vw,2.2rem)] font-medium leading-relaxed text-emerald-50">{idleMessage}</p> : null}{!idleVideoUrl ? <div className="mx-auto mt-10 flex w-fit items-center gap-3 rounded-full border border-emerald-100/20 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-emerald-100 sm:text-base"><span className="size-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,.9)] motion-safe:animate-pulse" />{label(fr, "Nous vous accueillons dès votre arrivée", "We welcome you as soon as you arrive")}</div> : null}</div></section> : <>          <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(23rem,.85fr)] xl:gap-7">
            <section className="flex min-h-[30rem] flex-col rounded-[2rem] bg-white p-6 text-slate-950 shadow-[0_24px_70px_-36px_rgba(0,0,0,.72)] sm:rounded-[2.5rem] sm:p-9 xl:min-h-0 xl:p-12" aria-label={label(fr, "Numéro actuellement appelé", "Currently called ticket")}>
              <p className="text-sm font-extrabold tracking-[.18em] text-emerald-700 sm:text-base">{label(fr, "EN COURS", "NOW SERVING")}</p>
              {activeCalls.length ? <div className={`mt-5 grid flex-1 content-center gap-5 ${hasMultipleActiveCalls ? "2xl:grid-cols-2" : ""}`}>{activeCalls.map((call: any) => <article key={`${call.ticket}-${call.deskName ?? "desk"}`} className="rounded-[1.75rem] border border-emerald-100 bg-[linear-gradient(145deg,rgba(236,253,245,.98),rgba(209,250,229,.74))] p-6 shadow-sm sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><p className={hasMultipleActiveCalls ? "text-[clamp(5.5rem,9vw,11rem)] font-black leading-none tracking-[-.09em] text-slate-950" : "text-[clamp(7.5rem,16vw,18rem)] font-black leading-[.82] tracking-[-.1em] text-slate-950"}>#{call.ticket}</p>{call.deskName ? <span className={hasMultipleActiveCalls ? "rounded-full bg-emerald-700 px-5 py-3 text-xl font-extrabold text-white shadow-sm" : "rounded-3xl bg-emerald-700 px-7 py-5 text-[clamp(2.5rem,4vw,5rem)] font-black leading-none tracking-tight text-white shadow-xl shadow-emerald-950/25"}>{displayDeskName(call.deskName, fr)}</span> : null}</div><p className={hasMultipleActiveCalls ? "mt-5 truncate text-3xl font-extrabold tracking-tight text-emerald-950 sm:text-4xl" : "mt-7 truncate text-[clamp(2.4rem,5.1vw,6.4rem)] font-extrabold leading-tight tracking-tight text-emerald-950"}>{call.visitorName}</p><p className={hasMultipleActiveCalls ? "mt-3 text-lg font-bold text-slate-700" : "mt-4 text-[clamp(1.1rem,1.8vw,2rem)] font-bold text-slate-700"}>{call.serviceName ?? label(fr, "Veuillez vous présenter", "Please come forward")}</p>{call.message ? <p className={hasMultipleActiveCalls ? "mt-5 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-base font-semibold leading-6 text-slate-700" : "mt-7 rounded-2xl border border-white/80 bg-white/80 px-5 py-4 text-[clamp(1.1rem,1.65vw,1.8rem)] font-semibold leading-relaxed text-slate-700"}>{call.message}</p> : null}</article>)}</div> : <div className="grid flex-1 content-center"><p className="text-[clamp(8rem,16vw,18rem)] font-black leading-none tracking-[-.1em] text-slate-950">—</p><p className="mt-5 text-[clamp(1.8rem,3.2vw,4rem)] font-extrabold tracking-tight text-emerald-800">{label(fr, "Veuillez patienter", "Please wait")}</p></div>}
            </section>
            <aside className="flex min-h-[30rem] flex-col rounded-[2rem] border border-emerald-100/20 bg-emerald-950/45 p-6 shadow-[0_24px_70px_-36px_rgba(0,0,0,.72)] backdrop-blur-sm sm:rounded-[2.5rem] sm:p-8 xl:min-h-0 xl:p-10" aria-label={label(fr, "Numéros en attente", "Waiting tickets")}>
              <p className="text-sm font-extrabold tracking-[.18em] text-emerald-100 sm:text-base">{label(fr, "EN ATTENTE", "WAITING")}</p>
              <div className="mt-5 grid gap-3">{waiting.slice(0, 6).map((item: any) => <div key={item.ticket} className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-4 shadow-sm sm:gap-5 sm:px-5"><p className="shrink-0 text-[clamp(2.75rem,4.4vw,5.25rem)] font-black leading-none tracking-[-.08em] text-white">#{item.ticket}</p><div className="min-w-0 flex-1 overflow-hidden"><p className="max-w-full truncate text-[clamp(1.75rem,2.5vw,3.5rem)] font-extrabold leading-tight tracking-tight text-emerald-50">{item.visitorName}</p><p className="mt-2 max-w-full truncate text-[clamp(1rem,1.35vw,1.5rem)] font-semibold text-emerald-200">{item.serviceName}</p></div></div>)}</div>
              {!waiting.length ? <div className="grid flex-1 place-items-center text-center"><p className="text-xl font-semibold text-emerald-100">{label(fr, "Aucun numéro en attente", "No tickets waiting")}</p></div> : null}
            </aside>
          </div>

          </>}          <p className="mt-5 pb-1 text-center text-xs leading-5 text-emerald-100 sm:mt-6 sm:text-sm">{label(fr, "Les noms affichent uniquement le prénom et l’initiale afin de protéger la confidentialité des visiteurs.", "Names are shown as first name and initial to protect visitor privacy.")}</p>
        </>}
      </section>
    </main>
  );
}