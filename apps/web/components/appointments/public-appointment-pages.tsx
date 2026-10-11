"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarCheck2,
  CheckCircle2,
  Loader2,
  MonitorPlay,
  QrCode,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, post } from "@/lib/api";
import { API_PREFIX } from "@/lib/constants";
import { FarmDisplayBoard } from "@/components/displays/farm-display-board";

type Site = {
  code: string;
  name: string;
  provinceName: string;
  bookingOpensAt: string;
  bookingClosesAt: string;
  organizationName: string;
};
type Course = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
};
type Detail = {
  organizationName: string;
  site: { code: string; name: string };
  settings: {
    bookingOpensAt: string;
    bookingClosesAt: string;
    welcomeMessage: string | null;
  };
  services: Course[];
};
type AvailableSlots = { slots: Array<{ value: string; localTime: string }> };
const publicUrl = (org: string, rest: string) =>
  `/public/organizations/${org}/appointments/${rest}`;
const label = (fr: boolean, a: string, b: string) => (fr ? a : b);
const displayDeskName = (name: string | null | undefined, fr: boolean) => {
  const value = name?.trim();
  return !value || /^(desk|guichet)$/i.test(value)
    ? label(fr, "Guichet 1", "Desk 1")
    : value;
};

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_50%_-10%,rgba(20,184,166,.16),transparent_40%),var(--color-page)] px-4 py-7 sm:py-10">
      <div className="mx-auto max-w-3xl">{children}</div>
    </main>
  );
}

export function PublicBookingPage({ orgSlug }: { orgSlug: string }) {
  const [fr, setFr] = useState(true);
  const [siteCode, setSiteCode] = useState("");
  const [form, setForm] = useState({
    serviceId: "",
    date: new Date().toISOString().slice(0, 10),
    visitorName: "",
    visitorEmail: "",
    visitorPhone: "",
    reason: "",
    scheduledAt: "",
  });
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("site");
    if (value) setSiteCode(value);
  }, []);
  const sites = useQuery({
    queryKey: ["public-appointment-sites", orgSlug],
    queryFn: () =>
      get<{ sites: Site[] }>(publicUrl(orgSlug, "sites")).then(
        (data) => data.sites,
      ),
  });
  const detail = useQuery({
    queryKey: ["public-appointment-site", orgSlug, siteCode],
    enabled: Boolean(siteCode),
    queryFn: () => get<Detail>(publicUrl(orgSlug, `sites/${siteCode}`)),
  });
  const slots = useQuery({
    queryKey: [
      "public-appointment-slots",
      orgSlug,
      siteCode,
      form.serviceId,
      form.date,
    ],
    enabled: Boolean(siteCode && form.serviceId && form.date),
    queryFn: () =>
      get<AvailableSlots>(
        `${publicUrl(orgSlug, `sites/${siteCode}/slots`)}?date=${encodeURIComponent(form.date)}&serviceId=${encodeURIComponent(form.serviceId)}`,
      ),
  });
  const booking = useMutation({
    mutationFn: () =>
      post<any>(publicUrl(orgSlug, "book"), {
        ...form,
        siteCode,
        preferredLanguage: fr ? "fr" : "en",
        visitorEmail: form.visitorEmail || null,
        visitorPhone: form.visitorPhone || null,
        scheduledAt: form.scheduledAt,
      }),
    onError: (error: Error) => toast.error(error.message),
  });
  const result = booking.data;
  return (
    <PublicShell>
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink">
            <CalendarCheck2 className="size-5" />
          </span>{" "}
          LiteHubs
        </div>
        <button
          type="button"
          className="text-xs font-semibold text-brand"
          onClick={() => setFr((value) => !value)}
        >
          {fr ? "EN" : "FR"}
        </button>
      </header>
      <Card className="overflow-hidden shadow-[0_20px_65px_-45px_rgba(15,23,42,.8)]">
        <div className="bg-[linear-gradient(125deg,#0b3b31,#0f766e)] px-6 py-8 text-white">
          <p className="text-xs font-bold tracking-wider text-emerald-100">
            {label(fr, "RÉSERVATION EN LIGNE", "ONLINE BOOKING")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">
            {detail.data?.organizationName ??
              sites.data?.[0]?.organizationName ??
              "LiteHubs"}
          </h1>
          <p className="mt-2 text-sm text-emerald-50">
            {label(
              fr,
              "Choisissez un site, un service et une heure. Votre demande reste privée.",
              "Choose a site, service and time. Your request stays private.",
            )}
          </p>
        </div>
        <CardContent className="p-5 sm:p-7">
          {result ? (
            <div className="py-5 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="size-7" />
              </span>
              <h2 className="mt-4 text-xl font-semibold text-ink">
                {label(fr, "Rendez-vous confirmé", "Appointment confirmed")}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">
                {label(
                  fr,
                  "Votre rendez-vous a été enregistré. Présentez-vous à l’accueil du site à l’heure choisie.",
                  "Your appointment has been registered. Please arrive at the site reception at your selected time.",
                )}
              </p>
              <Button
                className="mt-5"
                variant="secondary"
                onClick={() => {
                  booking.reset();
                  setForm({
                    serviceId: "",
                    date: new Date().toISOString().slice(0, 10),
                    visitorName: "",
                    visitorEmail: "",
                    visitorPhone: "",
                    reason: "",
                    scheduledAt: "",
                  });
                }}
              >
                {label(
                  fr,
                  "Prendre un autre rendez-vous",
                  "Book another appointment",
                )}
              </Button>
            </div>
          ) : sites.isLoading || (siteCode && detail.isLoading) ? (
            <SkeletonCard rows={6} />
          ) : sites.isError || detail.isError ? (
            <ErrorState
              title={label(
                fr,
                "Réservation indisponible",
                "Booking unavailable",
              )}
              description={String(
                (sites.error ?? (detail.error as Error))?.message ?? "",
              )}
              onRetry={() => {
                void sites.refetch();
                void detail.refetch();
              }}
            />
          ) : !sites.data?.length ? (
            <EmptyState
              title={label(
                fr,
                "Aucun site ne prend de rendez-vous",
                "No site is accepting bookings",
              )}
              description={label(
                fr,
                "Réessayez plus tard ou contactez directement l’entreprise.",
                "Try again later or contact the organization directly.",
              )}
            />
          ) : (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                booking.mutate();
              }}
            >
              <Field label={label(fr, "Site", "Site")} required>
                <select
                  className="control"
                  required
                  value={siteCode}
                  onChange={(event) => {
                    setSiteCode(event.target.value);
                    setForm((state) => ({
                      ...state,
                      serviceId: "",
                      scheduledAt: "",
                    }));
                  }}
                >
                  <option value="">—</option>
                  {sites.data.map((site) => (
                    <option key={site.code} value={site.code}>
                      {site.name} · {site.provinceName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={label(fr, "Service", "Service")} required>
                <select
                  className="control"
                  required
                  disabled={!detail.data}
                  value={form.serviceId}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      serviceId: event.target.value,
                      scheduledAt: "",
                    }))
                  }
                >
                  <option value="">—</option>
                  {detail.data?.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} · {service.durationMinutes} min
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={label(fr, "Date", "Date")} required>
                <Input
                  required
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={form.date}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      date: event.target.value,
                      scheduledAt: "",
                    }))
                  }
                />
              </Field>
              <Field
                label={label(fr, "Heure disponible", "Available time")}
                required
              >
                <select
                  className="control"
                  required
                  disabled={
                    !form.serviceId ||
                    slots.isLoading ||
                    !slots.data?.slots.length
                  }
                  value={form.scheduledAt}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      scheduledAt: event.target.value,
                    }))
                  }
                >
                  <option value="" disabled>
                    {!form.serviceId
                      ? label(fr, "Choisissez un service", "Choose a service")
                      : slots.isLoading
                        ? label(
                            fr,
                            "Recherche des créneaux…",
                            "Finding available times…",
                          )
                        : !slots.data?.slots.length
                          ? label(
                              fr,
                              "Aucun créneau disponible",
                              "No time available",
                            )
                          : label(fr, "Choisissez une heure", "Choose a time")}
                  </option>
                  {slots.data?.slots.map((slot) => (
                    <option key={slot.value} value={slot.value}>
                      {slot.localTime}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={label(fr, "Nom complet", "Full name")} required>
                <Input
                  required
                  value={form.visitorName}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="E-mail"
                required
                hint={label(
                  fr,
                  "Indiquez un e-mail pour recevoir la confirmation et l’appel de votre numéro.",
                  "Enter an email to receive confirmation and queue-call updates.",
                )}
              >
                <Input
                  required
                  type="email"
                  value={form.visitorEmail}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorEmail: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label={label(fr, "Téléphone", "Phone")}
                hint={label(
                  fr,
                  "Renseignez au moins un e-mail ou téléphone.",
                  "Enter at least an email or phone number.",
                )}
              >
                <PhoneInput
                  fr={fr}
                  value={form.visitorPhone}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorPhone: event.target.value,
                    }))
                  }
                  onNormalizedChange={(visitorPhone) =>
                    setForm((state) => ({ ...state, visitorPhone }))
                  }
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label={label(
                  fr,
                  "Motif de la visite (facultatif)",
                  "Visit reason (optional)",
                )}
              >
                <Textarea
                  value={form.reason}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      reason: event.target.value,
                    }))
                  }
                />
              </Field>
              {detail.data?.settings.welcomeMessage ? (
                <p className="sm:col-span-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-secondary">
                  {detail.data.settings.welcomeMessage}
                </p>
              ) : null}
              <div className="sm:col-span-2 flex justify-end">
                <Button loading={booking.isPending}>
                  <CalendarCheck2 />
                  {label(fr, "Confirmer le rendez-vous", "Confirm appointment")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}

export function PublicCheckInPage({
  orgSlug,
  siteCode,
}: {
  orgSlug: string;
  siteCode: string;
}) {
  const [fr, setFr] = useState(true);
  const [token, setToken] = useState("");
  const [form, setForm] = useState({
    serviceId: "",
    visitorName: "",
    visitorEmail: "",
    visitorPhone: "",
    reason: "",
  });
  useEffect(
    () =>
      setToken(new URLSearchParams(window.location.search).get("token") ?? ""),
    [],
  );
  const detail = useQuery({
    queryKey: ["public-qr-site", orgSlug, siteCode],
    enabled: Boolean(token),
    queryFn: () =>
      get<Detail>(publicUrl(orgSlug, `sites/${siteCode}?mode=checkin`)),
  });
  const checkIn = useMutation({
    mutationFn: () =>
      post<any>(publicUrl(orgSlug, `sites/${siteCode}/check-in`), {
        ...form,
        token,
        preferredLanguage: fr ? "fr" : "en",
        visitorEmail: form.visitorEmail || null,
        visitorPhone: form.visitorPhone || null,
      }),
    onError: (error: Error) => toast.error(error.message),
  });
  const done = checkIn.data;
  return (
    <PublicShell>
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink">
            <QrCode className="size-5" />
          </span>{" "}
          LiteHubs
        </div>
        <button
          type="button"
          className="text-xs font-semibold text-brand"
          onClick={() => setFr((value) => !value)}
        >
          {fr ? "EN" : "FR"}
        </button>
      </header>
      <Card className="overflow-hidden">
        <div className="bg-[linear-gradient(125deg,#0b3b31,#0f766e)] px-6 py-8 text-white">
          <p className="text-xs font-bold tracking-wider text-emerald-100">
            {label(fr, "ARRIVÉE SANS CONTACT", "CONTACTLESS CHECK-IN")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold">
            {detail.data?.site.name ??
              label(fr, "Enregistrement d’arrivée", "Check in")}
          </h1>
          <p className="mt-2 text-sm text-emerald-50">
            {label(
              fr,
              "Saisissez vos informations pour recevoir votre numéro de file.",
              "Enter your details to receive your queue ticket.",
            )}
          </p>
        </div>
        <CardContent className="p-5 sm:p-7">
          {done ? (
            <div className="py-5 text-center">
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand/10 text-brand">
                <UsersRound className="size-8" />
              </span>
              <p className="mt-4 text-sm text-ink-secondary">
                {label(fr, "Votre numéro de file", "Your queue ticket")}
              </p>
              <p className="mt-1 text-5xl font-bold tracking-[-.06em] text-ink">
                #{done.ticket?.number}
              </p>
              <p className="mt-4 text-sm text-ink-secondary">
                {done.welcomeMessage ??
                  label(
                    fr,
                    "Veuillez attendre l’appel de votre numéro.",
                    "Please wait for your ticket to be called.",
                  )}
              </p>
              <p className="mx-auto mt-3 max-w-md rounded-xl bg-brand/5 px-3 py-2 text-xs leading-5 text-ink-secondary">
                {done.confirmationChannel === "email"
                  ? label(
                      fr,
                      "La confirmation est envoyée par e-mail. Nous vous écrirons lorsque votre numéro sera appelé.",
                      "Your confirmation was emailed. We will email you when your ticket is called.",
                    )
                  : label(
                      fr,
                      "Gardez ce numéro. L’accueil l’appellera à l’écran lorsqu’il sera prêt.",
                      "Keep this ticket. Reception will call it on the display when ready.",
                    )}
              </p>
            </div>
          ) : !token ? (
            <EmptyState
              title={label(fr, "Lien QR incomplet", "Incomplete QR link")}
              description={label(
                fr,
                "Scannez de nouveau le QR affiché par le site.",
                "Scan the QR displayed by the site again.",
              )}
            />
          ) : detail.isLoading ? (
            <SkeletonCard rows={6} />
          ) : detail.isError ? (
            <ErrorState
              title={label(fr, "Arrivée indisponible", "Check-in unavailable")}
              description={(detail.error as Error).message}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                checkIn.mutate();
              }}
            >
              <Field label={label(fr, "Service", "Service")} required>
                <select
                  className="control"
                  required
                  value={form.serviceId}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      serviceId: event.target.value,
                    }))
                  }
                >
                  <option value="">—</option>
                  {detail.data?.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="hidden sm:block" />
              <Field label={label(fr, "Nom complet", "Full name")} required>
                <Input
                  required
                  value={form.visitorName}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="E-mail"
                required
                hint={label(
                  fr,
                  "Indiquez un e-mail pour recevoir la confirmation et l’appel de votre numéro.",
                  "Enter an email to receive confirmation and queue-call updates.",
                )}
              >
                <Input
                  required
                  type="email"
                  value={form.visitorEmail}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorEmail: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={label(fr, "Téléphone", "Phone")}>
                <PhoneInput
                  fr={fr}
                  value={form.visitorPhone}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      visitorPhone: event.target.value,
                    }))
                  }
                  onNormalizedChange={(visitorPhone) =>
                    setForm((state) => ({ ...state, visitorPhone }))
                  }
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Motif de votre rendez-vous",
                  "Reason for your visit",
                )}
                required
              >
                <Textarea
                  required
                  rows={3}
                  value={form.reason}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      reason: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="sm:col-span-2 flex justify-end">
                <Button loading={checkIn.isPending}>
                  <QrCode />
                  {label(fr, "Prendre mon numéro", "Get my ticket")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}

function announceQueueTicket(
  ticket: number,
  deskName: string | null | undefined,
  message: string | null | undefined,
  fr: boolean,
) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const destination = deskName
    ? fr
      ? `au ${displayDeskName(deskName, fr)}`
      : `at ${displayDeskName(deskName, fr)}`
    : fr
      ? "à l’accueil"
      : "at reception";
  const defaultMessage = fr
    ? `Numéro ${ticket}, veuillez vous présenter ${destination}.`
    : `Ticket number ${ticket}, please come to reception ${destination}.`;
  const announcement = message?.trim()
    ? fr
      ? `Numéro ${ticket}. ${message.trim()}`
      : `Ticket number ${ticket}. ${message.trim()}`
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
    oscillator.frequency.setValueAtTime(
      index === 0 ? 740 : 988,
      start + offset,
    );
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.24);
  });
}

export function PublicQueuePage({
  orgSlug,
  siteCode,
}: {
  orgSlug: string;
  siteCode: string;
}) {
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
  const activeCallKey = activeCalls
    .map((call: any) => `${call.ticket}:${call.deskName ?? ""}`)
    .sort()
    .join("|");
  const tvNotEnabled =
    queue.error instanceof ApiError && queue.error.status === 404;
  const unavailableTitle = tvNotEnabled
    ? label(
        fr,
        "Écran TV non activé pour ce site",
        "TV display is not enabled for this site",
      )
    : label(
        fr,
        "File temporairement indisponible",
        "Queue temporarily unavailable",
      );
  const unavailableDescription = tvNotEnabled
    ? label(
        fr,
        "Dans Rendez-vous → Configurer, activez Écran de file TV puis enregistrez.",
        "In Appointments → Configure, enable Queue TV display and save.",
      )
    : label(
        fr,
        "Vérifiez la connexion puis réessayez.",
        "Check the connection and try again.",
      );

  useEffect(() => {
    const hasPreviousSnapshot = hasSeenQueueState.current;
    hasSeenQueueState.current = true;
    const freshCalls = activeCalls.filter((call: any) => {
      const key = `${call.ticket}:${call.deskName ?? ""}`;
      if (announcedCalls.current.has(key)) return false;
      announcedCalls.current.add(key);
      return true;
    });
    if (
      !soundEnabled ||
      !hasPreviousSnapshot ||
      !freshCalls.length ||
      !audioContext.current
    )
      return;
    void audioContext.current
      .resume()
      .then(() => {
        freshCalls.forEach((call: any, index: number) => {
          window.setTimeout(() => {
            if (!audioContext.current) return;
            playQueueCallChime(audioContext.current);
            announceQueueTicket(
              Number(call.ticket),
              call.deskName,
              call.message,
              fr,
            );
          }, index * 2_800);
        });
      })
      .catch(() => undefined);
  }, [activeCallKey, fr, soundEnabled]);
  const toggleSound = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;
    audioContext.current ??= new AudioContextConstructor();
    await audioContext.current.resume();
    setSoundEnabled(true);
    playQueueCallChime(audioContext.current);
    activeCalls.forEach((call: any, index: number) => {
      announcedCalls.current.add(`${call.ticket}:${call.deskName ?? ""}`);
      window.setTimeout(
        () =>
          announceQueueTicket(
            Number(call.ticket),
            call.deskName,
            call.message,
            fr,
          ),
        index * 2_800,
      );
    });
  };

  const hasMultipleActiveCalls = activeCalls.length > 1;
  const isQueueIdle = !activeCalls.length && !waiting.length;
  const idleVideoId = queue.data?.idleDisplay?.videoId;
  const hasIdleVideo = Boolean(idleVideoId);
  const idleVideoUrl = hasIdleVideo
    ? API_PREFIX +
      publicUrl(orgSlug, "sites/" + siteCode + "/idle-video") +
      "?v=" +
      encodeURIComponent(String(idleVideoId))
    : null;
  const idleTitle =
    queue.data?.idleDisplay?.title?.trim() ||
    (hasIdleVideo ? "" : label(fr, "Bienvenue", "Welcome"));
  const idleMessage =
    queue.data?.idleDisplay?.message?.trim() ||
    (hasIdleVideo
      ? ""
      : label(
          fr,
          "Nous sommes prêts à vous accueillir. Présentez-vous au guichet ou suivez les instructions du site.",
          "We are ready to welcome you. Please come to reception or follow the site instructions.",
        ));
  const idleScreenToken: string | null = queue.data?.idleDisplay?.screenToken ?? null;

  // While nobody waits, the linked display screen (videos, statistics, ticker)
  // takes over; the queue polling keeps running and brings the queue back.
  if (queue.data && isQueueIdle && idleScreenToken)
    return (
      <div className="relative">
        <FarmDisplayBoard token={idleScreenToken} idleOnly />
        {!soundEnabled ? (
          <button
            type="button"
            onClick={() => void toggleSound()}
            className="fixed bottom-14 right-5 z-50 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/25 bg-black/50 px-4 text-sm font-bold text-white backdrop-blur transition hover:bg-black/70"
          >
            <MonitorPlay className="size-4" />
            {label(fr, "Activer le son des appels", "Enable call sound")}
          </button>
        ) : null}
      </div>
    );

  const called = activeCalls.filter((call: any) => call.status === "called");
  const tickerText = [
    queue.data?.idleDisplay?.title?.trim(),
    queue.data?.idleDisplay?.message?.trim(),
    label(
      fr,
      "Les noms affichent uniquement le prénom et l’initiale afin de protéger la confidentialité des visiteurs.",
      "Names are shown as first name and initial to protect visitor privacy.",
    ),
  ]
    .filter(Boolean)
    .join("   •   ");
  const initials = (queue.data?.organizationName ?? "LiteHubs")
    .split(/\s+/)
    .map((word: string) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="flex min-h-dvh flex-col overflow-x-hidden bg-[#050d24] xl:h-dvh xl:min-h-[34rem] xl:overflow-hidden bg-[radial-gradient(ellipse_at_top,#12306e_0%,#0a1a44_45%,#050d24_100%)] text-white">
      {/* Header — same look as the display screens. */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b-4 border-amber-400 bg-[#0a1a44]/80 px-5 py-3 sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-400 text-lg font-black text-[#0a1a44] shadow-lg sm:size-14 sm:text-xl">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-black uppercase tracking-wide sm:text-3xl">
              {queue.data?.organizationName ?? "LiteHubs"}
            </p>
            <p className="truncate text-sm font-semibold text-sky-200 sm:text-base">
              {label(fr, "Accueil", "Reception")} · {queue.data?.siteName ?? "…"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => void toggleSound()}
            aria-pressed={soundEnabled}
            className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-2 text-xs font-bold uppercase tracking-wide transition sm:px-4 sm:text-sm ${soundEnabled ? "border-emerald-300/60 text-emerald-200" : "animate-pulse border-amber-300 bg-amber-400 text-[#0a1a44]"}`}
          >
            {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            <span className="hidden sm:inline">
              {soundEnabled ? label(fr, "Son activé", "Sound on") : label(fr, "Activer le son", "Enable sound")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFr((value) => !value)}
            className="rounded-full border-2 border-white/25 px-3 py-2 text-xs font-bold tracking-[.12em] text-white/85 transition hover:bg-white/10 sm:text-sm"
            aria-label={label(fr, "Afficher en anglais", "Show in French")}
          >
            {fr ? "EN" : "FR"}
          </button>
          <QueueClock fr={fr} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-5 py-5 sm:px-8 sm:py-6">
        {queue.isLoading ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-10 animate-spin text-sky-200" />
          </div>
        ) : queue.isError ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <p className="text-2xl font-semibold">{unavailableTitle}</p>
              <p className="mt-3 max-w-md text-base leading-7 text-sky-100">{unavailableDescription}</p>
              <Button type="button" variant="secondary" className="mt-6" onClick={() => void queue.refetch()}>
                {label(fr, "Réessayer", "Try again")}
              </Button>
            </div>
          </div>
        ) : isQueueIdle ? (
              <section className="relative grid flex-1 place-items-center overflow-hidden rounded-[2rem] border border-emerald-100/20 bg-[linear-gradient(135deg,rgba(6,78,59,.92),rgba(5,46,38,.96))] px-6 py-12 text-center shadow-[0_24px_70px_-36px_rgba(0,0,0,.72)] sm:rounded-[2.5rem] sm:px-12">
                {idleVideoUrl ? (
                  <>
                    {/* Same look as the display screens: blurred copy behind, full video on top. */}
                    <video
                      key={"bg-" + idleVideoUrl}
                      src={idleVideoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-70 blur-3xl saturate-150"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
                    <video
                      key={idleVideoUrl}
                      src={idleVideoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      className="absolute inset-0 z-10 size-full object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
                      aria-label={label(fr, "Vidéo d’accueil", "Welcome video")}
                    />
                  </>
                ) : null}
                <div className="absolute -left-24 -top-24 size-80 rounded-full bg-emerald-300/10 blur-3xl motion-safe:animate-pulse" />
                <div className="absolute -bottom-28 -right-20 size-96 rounded-full bg-teal-300/10 blur-3xl motion-safe:animate-pulse" />
                {idleVideoUrl && (idleTitle || idleMessage) ? (
                  <div className="absolute inset-x-0 bottom-0 z-20 overflow-hidden whitespace-nowrap border-t-2 border-amber-400/70 bg-[#0a1a44]/85 py-3 text-[clamp(1rem,1.6vw,1.8rem)]">
                    <span className="inline-block animate-[lh-ticker_30s_linear_infinite] pl-[100%] font-semibold text-amber-200">
                      {[idleTitle, idleMessage].filter(Boolean).join("  •  ")}
                    </span>
                  </div>
                ) : null}
                <div className={idleVideoUrl ? "hidden" : "relative max-w-4xl"}>
                  {!idleVideoUrl ? (
                    <span className="mx-auto grid size-20 place-items-center rounded-[1.75rem] border border-emerald-100/30 bg-white/10 text-emerald-100 shadow-xl sm:size-24">
                      <CalendarCheck2 className="size-10 sm:size-12" />
                    </span>
                  ) : null}
                  {idleTitle ? (
                    <p className="mt-7 text-sm font-extrabold tracking-[.2em] text-emerald-200 sm:text-base">
                      {label(fr, "ACCUEIL", "WELCOME")}
                    </p>
                  ) : null}
                  {idleTitle ? (
                    <h1 className="mt-4 text-[clamp(2.75rem,6vw,7rem)] font-black leading-[.98] tracking-tight text-white">
                      {idleTitle}
                    </h1>
                  ) : null}
                  {idleMessage ? (
                    <p className="mx-auto mt-6 max-w-3xl text-[clamp(1.15rem,2vw,2.2rem)] font-medium leading-relaxed text-emerald-50">
                      {idleMessage}
                    </p>
                  ) : null}
                  {!idleVideoUrl ? (
                    <div className="mx-auto mt-10 flex w-fit items-center gap-3 rounded-full border border-emerald-100/20 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-emerald-100 sm:text-base">
                      <span className="size-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,.9)] motion-safe:animate-pulse" />
                      {label(
                        fr,
                        "Nous vous accueillons dès votre arrivée",
                        "We welcome you as soon as you arrive",
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
        ) : (
          <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(26rem,1fr)] xl:gap-7">
            {/* Now serving */}
            <section
              className="flex min-h-0 flex-col"
              aria-label={label(fr, "Numéro actuellement appelé", "Currently called ticket")}
            >
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[.35em] text-amber-300">
                    {label(fr, "Appel en cours", "Now calling")}
                  </p>
                  <h1 className="text-[clamp(2rem,3.4vw,3.6rem)] font-black uppercase leading-none tracking-tight">
                    {label(fr, "Rendez-vous", "Appointments")}
                  </h1>
                </div>
                <div className="flex gap-3">
                  <QueueStat label={label(fr, "En attente", "Waiting")} value={waiting.length} tone="text-amber-300" />
                  <QueueStat label={label(fr, "Au guichet", "At desk")} value={activeCalls.length} tone="text-emerald-300" />
                </div>
              </div>
              {activeCalls.length ? (
                <div className={`mt-5 grid min-h-0 flex-1 gap-4 ${hasMultipleActiveCalls ? "grid-rows-2 2xl:grid-cols-2 2xl:grid-rows-1" : ""}`}>
                  {activeCalls.slice(0, hasMultipleActiveCalls ? 4 : 1).map((call: any) => {
                    const isCalled = call.status === "called";
                    return (
                      <article
                        key={`${call.ticket}-${call.deskName ?? "desk"}`}
                        className={`relative flex min-h-0 flex-col justify-center overflow-hidden rounded-3xl border-2 bg-[linear-gradient(145deg,rgba(18,48,110,.95),rgba(8,20,56,.98))] px-7 py-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,.9)] sm:px-10 ${isCalled ? "border-amber-400 animate-[lh-pulse-ring_2.4s_ease-out_infinite]" : "border-white/15"}`}
                      >
                        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-amber-400/10 blur-3xl" />
                        <div className="relative flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[.3em] text-sky-200 sm:text-sm">
                              {label(fr, "Ticket", "Ticket")}
                            </p>
                            <p
                              className={`font-mono font-black leading-none tracking-tight text-amber-300 tabular-nums ${hasMultipleActiveCalls ? "text-[clamp(4.5rem,8vw,9rem)]" : "text-[clamp(7rem,15vw,16rem)]"}`}
                            >
                              {String(call.ticket).padStart(3, "0")}
                            </p>
                          </div>
                          {call.deskName ? (
                            <div className="text-right">
                              <p className="text-xs font-bold uppercase tracking-[.3em] text-sky-200 sm:text-sm">
                                {label(fr, "Rendez-vous au", "Please go to")}
                              </p>
                              <p
                                className={`mt-2 inline-flex items-center gap-3 rounded-2xl bg-emerald-400 px-6 py-3 font-black uppercase leading-none text-[#04261c] shadow-xl shadow-emerald-950/40 ${hasMultipleActiveCalls ? "text-[clamp(1.6rem,2.6vw,2.8rem)]" : "text-[clamp(2.4rem,4.5vw,5rem)]"}`}
                              >
                                <span aria-hidden>→</span>
                                {displayDeskName(call.deskName, fr)}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="relative mt-5 border-t border-white/10 pt-5">
                          <p
                            className={`truncate font-extrabold leading-tight tracking-tight text-white ${hasMultipleActiveCalls ? "text-[clamp(1.8rem,2.8vw,3rem)]" : "text-[clamp(2.4rem,4.6vw,5.5rem)]"}`}
                          >
                            {call.visitorName}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <span
                              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold uppercase tracking-wide sm:text-base ${isCalled ? "bg-amber-400 text-[#0a1a44]" : "bg-emerald-400/15 text-emerald-200"}`}
                            >
                              <span className={`size-2.5 rounded-full ${isCalled ? "animate-pulse bg-[#0a1a44]" : "bg-emerald-300"}`} />
                              {isCalled ? label(fr, "Appelé — présentez-vous", "Called — please come") : label(fr, "Au guichet", "Being served")}
                            </span>
                            {call.serviceName ? (
                              <span className="text-[clamp(1rem,1.6vw,1.6rem)] font-semibold text-sky-100">{call.serviceName}</span>
                            ) : null}
                          </div>
                          {call.message ? (
                            <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-[clamp(1rem,1.5vw,1.6rem)] font-semibold leading-snug text-white/90">
                              {call.message}
                            </p>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5 grid flex-1 place-items-center rounded-3xl border-2 border-white/10 bg-white/[0.04] text-center">
                  <div>
                    <p className="font-mono text-[clamp(6rem,12vw,12rem)] font-black leading-none text-white/20">— — —</p>
                    <p className="mt-4 text-[clamp(1.6rem,3vw,3rem)] font-extrabold text-sky-100">
                      {label(fr, "Veuillez patienter, vous serez appelé", "Please wait, you will be called")}
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Next tickets — airport-board style */}
            <aside className="flex min-h-0 flex-col" aria-label={label(fr, "Numéros en attente", "Waiting tickets")}>
              <div className="flex items-end justify-between">
                <p className="text-sm font-bold uppercase tracking-[.35em] text-amber-300">
                  {label(fr, "Prochains numéros", "Next tickets")}
                </p>
                {called.length ? null : (
                  <p className="text-sm font-semibold text-sky-200">{label(fr, "Ordre de passage", "Order of service")}</p>
                )}
              </div>
              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a1a44]/70 shadow-[0_30px_80px_-40px_rgba(0,0,0,.9)]">
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] gap-3 bg-[#12306e] px-5 py-3 text-xs font-bold uppercase tracking-[.2em] text-sky-200 sm:grid-cols-[7rem_minmax(0,1fr)_5rem] sm:text-sm">
                  <span>{label(fr, "Ticket", "Ticket")}</span>
                  <span>{label(fr, "Nom · service", "Name · service")}</span>
                  <span className="text-right">{label(fr, "Rang", "Order")}</span>
                </div>
                {waiting.length ? (
                  <div className="min-h-0 flex-1 divide-y divide-white/5 overflow-hidden">
                    {waiting.slice(0, 8).map((item: any, index: number) => (
                      <div
                        key={item.ticket}
                        className={`grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 px-5 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_5rem] sm:py-4 ${index === 0 ? "bg-amber-400/10" : index % 2 ? "bg-white/[0.03]" : ""}`}
                      >
                        <span className={`font-mono text-[clamp(1.8rem,2.6vw,2.8rem)] font-black leading-none tabular-nums ${index === 0 ? "text-amber-300" : "text-white"}`}>
                          {String(item.ticket).padStart(3, "0")}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[clamp(1.2rem,1.8vw,1.9rem)] font-bold leading-tight text-white">
                            {item.visitorName}
                          </span>
                          {item.serviceName ? (
                            <span className="block truncate text-sm font-medium text-sky-200 sm:text-base">{item.serviceName}</span>
                          ) : null}
                        </span>
                        <span className={`text-right text-sm font-bold uppercase sm:text-base ${index === 0 ? "text-amber-300" : "text-sky-200"}`}>
                          {index === 0 ? label(fr, "Suivant", "Next") : `${index + 1}${fr ? "e" : ""}`}
                        </span>
                      </div>
                    ))}
                    {waiting.length > 8 ? (
                      <p className="px-5 py-3 text-center text-sm font-semibold text-sky-200">
                        + {waiting.length - 8} {label(fr, "autre(s) en attente", "more waiting")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid flex-1 place-items-center p-6 text-center">
                    <p className="text-xl font-semibold text-sky-100">{label(fr, "Aucun numéro en attente", "No tickets waiting")}</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* Footer ticker */}
      <footer className="relative shrink-0 overflow-hidden whitespace-nowrap border-t-2 border-amber-400/70 bg-[#0a1a44] py-3 text-[clamp(.95rem,1.4vw,1.5rem)]">
        <span className="inline-block animate-[lh-ticker_40s_linear_infinite] pl-[100%] font-semibold text-amber-200">
          {tickerText}
        </span>
      </footer>
    </main>
  );
}

function QueueClock({ fr }: { fr: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return null;
  const locale = fr ? "fr-FR" : "en-GB";
  return (
    <div className="hidden text-right sm:block">
      <p className="font-mono text-3xl font-black leading-none tabular-nums text-amber-300 lg:text-4xl">
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
        <span className="text-lg text-amber-200/70 lg:text-xl">:{String(now.getSeconds()).padStart(2, "0")}</span>
      </p>
      <p className="mt-1 text-xs font-semibold capitalize text-sky-200 lg:text-sm">
        {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
      </p>
    </div>
  );
}

function QueueStat({ label: text, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-right">
      <p className="text-[10px] font-bold uppercase tracking-[.25em] text-sky-200 sm:text-xs">{text}</p>
      <p className={`font-mono text-2xl font-black leading-none tabular-nums sm:text-3xl ${tone}`}>{value}</p>
    </div>
  );
}
