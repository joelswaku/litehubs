"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, Clock3, Landmark, MonitorPlay, Pencil, Plus, Send, Settings2, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { SiteQr } from "@/components/appointments/site-qr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, api, del, get, orgUrl, patch, post, put } from "@/lib/api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

const tr = (fr: boolean, french: string, english: string) => fr ? french : english;
const blankVisit = () => ({ siteId: "", serviceId: "", visitorName: "", visitorEmail: "", visitorPhone: "", reason: "", scheduledAt: "" });
const blankService = () => ({ siteId: "", code: "", name: "", description: "", durationMinutes: 20, allowsOnlineBooking: true, allowsQrCheckin: true, isActive: true });
const blankDesk = () => ({ siteId: "", code: "", name: "", isActive: true });
const blankCallMessage = () => ({ siteId: "", title: "", content: "", isActive: true });
const serviceCodeFromName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);

/** Maps API field failures to a helpful operator-facing notification. */
function appointmentFormError(error: Error, fr: boolean): string {
  if (!(error instanceof ApiError)) return error.message || tr(fr, "Impossible de créer le rendez-vous.", "Could not create the appointment.");
  if (error.fieldErrors.visitorPhone?.length)
    return tr(fr, "Téléphone : saisissez un numéro valide, par exemple +243 800 000 000.", "Phone: enter a valid number, for example +243 800 000 000.");
  if (error.fieldErrors.visitorEmail?.length)
    return tr(fr, "Ajoutez une adresse e-mail valide ou un numéro de téléphone.", "Enter a valid email address or phone number.");
  if (error.fieldErrors.visitorName?.length)
    return tr(fr, "Saisissez le nom du visiteur.", "Enter the visitor's name.");
  if (error.message.includes("no more than five active call messages"))
    return tr(fr, "Un site peut conserver au maximum cinq messages d’appel actifs.", "A site can keep at most five active call messages.");
  const firstFieldError = Object.values(error.fieldErrors).flat()[0];
  return firstFieldError ?? error.message;
}

export function AppointmentsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const readable = can(user, "appointments.read");
  const configurable = can(user, "appointments.create");
  const controllable = can(user, "appointments.update");
  const ownerOnlyConfiguration = isOwner(user);
  const [siteId, setSiteId] = useState("");
  const [upcomingOffset, setUpcomingOffset] = useState(0);
  const [deskId, setDeskId] = useState("");
  const [messageTemplateId, setMessageTemplateId] = useState("");
  const [panel, setPanel] = useState<"visit" | "service" | "desk" | "call-message" | null>(null);
  const [visit, setVisit] = useState(blankVisit);
  const [service, setService] = useState(blankService);
  const [desk, setDesk] = useState(blankDesk);
  const [callMessage, setCallMessage] = useState(blankCallMessage);
  const [serviceCodeManual, setServiceCodeManual] = useState(false);
  const [deskCodeManual, setDeskCodeManual] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<any | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingDeskId, setEditingDeskId] = useState<string | null>(null);
  const [editingCallMessageId, setEditingCallMessageId] = useState<string | null>(null);
  const [serviceToDeactivate, setServiceToDeactivate] = useState<any | null>(null);
  const [deskToDeactivate, setDeskToDeactivate] = useState<any | null>(null);
  const [callMessageToDeactivate, setCallMessageToDeactivate] = useState<any | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["appointments", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["appointment-summary", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["appointment-settings", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["appointment-services", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["appointment-desks", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["appointment-call-messages", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["upcoming-appointments", orgSlug] });
  };

  const summary = useQuery({
    queryKey: ["appointment-summary", orgSlug], enabled: readable, refetchInterval: 15_000,
    queryFn: () => get<any>(orgUrl(orgSlug, "appointments/summary")).then((response) => response.summary),
  });
  const settings = useQuery({
    queryKey: ["appointment-settings", orgSlug], enabled: readable,
    queryFn: () => get<any>(orgUrl(orgSlug, "appointments/settings")).then((response) => response.settings),
  });
  const services = useQuery({
    queryKey: ["appointment-services", orgSlug], enabled: readable,
    queryFn: () => get<any>(orgUrl(orgSlug, "appointments/services")).then((response) => response.services),
  });
  const desks = useQuery({
    queryKey: ["appointment-desks", orgSlug, siteId], enabled: readable,
    queryFn: () => get<any>(orgUrl(orgSlug, `appointments/desks${siteId ? `?siteId=${siteId}` : ""}`)).then((response) => response.desks),
  });
  const appointments = useQuery({
    queryKey: ["appointments", orgSlug, siteId], enabled: readable, refetchInterval: 15_000,
    queryFn: () => get<any>(orgUrl(orgSlug, `appointments?limit=100${siteId ? `&siteId=${siteId}` : ""}`)).then((response) => response.appointments),
  });
  const upcomingAppointments = useQuery({
    queryKey: ["upcoming-appointments", orgSlug, siteId, upcomingOffset], enabled: readable, refetchInterval: 15_000,
    queryFn: () => get<any>(orgUrl(orgSlug, `appointments?status=scheduled&limit=10&offset=${upcomingOffset}${siteId ? `&siteId=${siteId}` : ""}`)),
  });

  const createAppointment = useMutation({
    mutationFn: (payload: any) => post<any>(orgUrl(orgSlug, "appointments"), payload),
    onSuccess: (response) => {
      invalidate();
      setPanel(null);
      setVisit(blankVisit());
      const channel = response?.appointment?.notificationChannel;
      toast.success(
        channel === "email"
          ? tr(fr, "Rendez-vous créé — e-mail de confirmation envoyé.", "Appointment created — confirmation email sent.")
          : channel === "brevo_sms"
            ? tr(fr, "Rendez-vous créé — SMS de confirmation envoyé.", "Appointment created — confirmation SMS sent.")
            : tr(fr, "Rendez-vous créé. Aucun e-mail ou SMS n’a pu être envoyé.", "Appointment created. No email or SMS could be sent."),
      );
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });  const saveService = useMutation({
    mutationFn: (payload: any) => editingServiceId
      ? patch(orgUrl(orgSlug, `appointments/services/${editingServiceId}`), payload)
      : post(orgUrl(orgSlug, "appointments/services"), payload),
    onSuccess: () => {
      const wasEditing = Boolean(editingServiceId);
      invalidate();
      setPanel(null);
      setEditingServiceId(null);
      setService(blankService());
      setServiceCodeManual(false);
      toast.success(tr(fr, wasEditing ? "Service modifié" : "Service ajouté", wasEditing ? "Service updated" : "Service added"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const saveCallMessage = useMutation({
    mutationFn: (payload: any) => editingCallMessageId
      ? patch(orgUrl(orgSlug, `appointments/call-messages/${editingCallMessageId}`), payload)
      : post(orgUrl(orgSlug, "appointments/call-messages"), payload),
    onSuccess: () => {
      const wasEditing = Boolean(editingCallMessageId);
      invalidate();
      setPanel(null);
      setEditingCallMessageId(null);
      setCallMessage(blankCallMessage());
      toast.success(tr(fr, wasEditing ? "Message d’appel modifié" : "Message d’appel ajouté", wasEditing ? "Call message updated" : "Call message added"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const deactivateCallMessage = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `appointments/call-messages/${id}`)),
    onSuccess: () => {
      invalidate();
      if (messageTemplateId === callMessageToDeactivate?.id) setMessageTemplateId("");
      setCallMessageToDeactivate(null);
      toast.success(tr(fr, "Message d’appel retiré", "Call message removed"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });  const saveDesk = useMutation({
    mutationFn: (payload: any) => editingDeskId
      ? patch(orgUrl(orgSlug, `appointments/desks/${editingDeskId}`), payload)
      : post(orgUrl(orgSlug, "appointments/desks"), payload),
    onSuccess: () => {
      const wasEditing = Boolean(editingDeskId);
      invalidate();
      setPanel(null);
      setEditingDeskId(null);
      setDesk(blankDesk());
      setDeskCodeManual(false);
      toast.success(tr(fr, wasEditing ? "Guichet modifié" : "Guichet ajouté", wasEditing ? "Desk updated" : "Desk added"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const releaseDesk = useMutation({
    mutationFn: (id: string) => post(orgUrl(orgSlug, `appointments/desks/${id}/release`)),
    onSuccess: () => { invalidate(); setDeskId(""); toast.success(tr(fr, "Guichet libéré pour le prochain agent", "Desk released for the next agent")); },
    onError: (error: Error) => toast.error(error.message),
  });  const deactivateDesk = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `appointments/desks/${id}`)),
    onSuccess: () => {
      invalidate();
      if (deskId === deskToDeactivate?.id) setDeskId("");
      setDeskToDeactivate(null);
      toast.success(tr(fr, "Guichet retiré", "Desk removed"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const deactivateService = useMutation({
    mutationFn: (id: string) => del(orgUrl(orgSlug, `appointments/services/${id}`)),
    onSuccess: () => {
      invalidate();
      setServiceToDeactivate(null);
      toast.success(tr(fr, "Service retiré des réservations", "Service removed from bookings"));
    },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const saveSettings = useMutation({
    mutationFn: (payload: any) => put(orgUrl(orgSlug, "appointments/settings"), payload),
    onSuccess: () => { invalidate(); setSettingsOpen(null); toast.success(tr(fr, "Configuration enregistrée", "Settings saved")); },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });
  const transition = useMutation({
    mutationFn: ({ id, status, deskId: assignedDeskId }: { id: string; status: string; deskId?: string }) => patch(orgUrl(orgSlug, `appointments/${id}/status`), { status, deskId: assignedDeskId || undefined }),
    onSuccess: invalidate, onError: (error: Error) => toast.error(error.message),
  });
  const checkIn = useMutation({
    mutationFn: (id: string) => post(orgUrl(orgSlug, `appointments/${id}/check-in`)),
    onSuccess: invalidate,
    onError: (error: Error) => {
      invalidate();
      toast.error(error.message === "This appointment can no longer be checked in"
        ? tr(fr, "Ce rendez-vous a déjà été traité par un autre guichet. La liste vient d’être actualisée.", "This appointment was already handled by another desk. The list has been refreshed.")
        : appointmentFormError(error, fr));
    },
  });
  const callNext = useMutation({
    mutationFn: (payload: any) => post<any>(orgUrl(orgSlug, "appointments/queue/call-next"), payload),
    onSuccess: (response) => { invalidate(); toast.success(response?.appointment ? tr(fr, "Le prochain visiteur est appelé", "The next visitor was called") : tr(fr, "La file est vide", "The queue is empty")); },
    onError: (error: Error) => toast.error(appointmentFormError(error, fr)),
  });

  // The API normally guarantees a site id. Keep the UI stable if an old or malformed row is returned during an upgrade.
  const sites = useMemo(() => {
    const seen = new Set<string>();
    return (settings.data ?? []).filter((item: any) => {
      const id = typeof item?.site?.id === "string" ? item.site.id : "";
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [settings.data]);
  const rows = appointments.data ?? [];
  const live = rows.filter((row: any) => ["waiting", "checked_in", "called", "serving"].includes(row.status));
  const upcoming = upcomingAppointments.data?.appointments ?? [];
  const upcomingPage = upcomingAppointments.data?.page;
  const selectedSite = siteId || (sites.length === 1 ? sites[0]?.site.id : "");
  const callMessages = useQuery({
    queryKey: ["appointment-call-messages", orgSlug, selectedSite],
    enabled: readable,
    queryFn: () => get<any>(orgUrl(orgSlug, `appointments/call-messages${selectedSite ? `?siteId=${selectedSite}` : ""}`)).then((response) => response.messages),
  });
  const activeCallMessages = useMemo(() => (callMessages.data ?? []).filter((item: any) => item.isActive && item.site.id === selectedSite), [callMessages.data, selectedSite]);
  const selectedCallMessage = activeCallMessages.find((item: any) => item.id === messageTemplateId) ?? null;
  const availableDesks = useMemo(() => (desks.data ?? []).filter((item: any) => item.isActive && item.site.id === selectedSite), [desks.data, selectedSite]);
  const displayedDesks = useMemo(() => (desks.data ?? []).filter((item: any) => item.isActive), [desks.data]);
  const availableServices = useMemo(() => (services.data ?? []).filter((item: any) => item.site.id === visit.siteId && item.isActive), [services.data, visit.siteId]);
  const displayedServices = useMemo(() => (services.data ?? []).filter((item: any) => item.isActive), [services.data]);
  const serviceGroups = useMemo(() => {
    const grouped = new Map<string, { site: any; services: any[] }>();
    sites.forEach((setting: any) => grouped.set(setting.site.id, { site: setting.site, services: [] }));
    displayedServices.forEach((item: any) => {
      const current = grouped.get(item.site.id) ?? { site: item.site, services: [] };
      current.services.push(item);
      grouped.set(item.site.id, current);
    });
    return [...grouped.values()];
  }, [sites, displayedServices]);
  const openNewService = (targetSiteId?: string) => {
    setEditingServiceId(null);
    setServiceCodeManual(false);
    setService({ ...blankService(), siteId: targetSiteId || selectedSite || sites[0]?.site.id || "" });
    setPanel("service");
  };
  const nextDeskDefaults = (targetSiteId: string) => {
    const takenCodes = new Set((desks.data ?? []).filter((item: any) => item.site.id === targetSiteId).map((item: any) => item.code));
    let number = 1;
    while (takenCodes.has(`desk_${number}`)) number += 1;
    return {
      name: tr(fr, `Guichet ${number}`, `Desk ${number}`),
      code: `desk_${number}`,
    };
  };
  const openNewDesk = () => {
    const targetSiteId = selectedSite || sites[0]?.site.id || "";
    setEditingDeskId(null);
    setDeskCodeManual(false);
    setDesk({ ...blankDesk(), siteId: targetSiteId, ...nextDeskDefaults(targetSiteId) });
    setPanel("desk");
  };
  const openEditDesk = (item: any) => {
    setEditingDeskId(item.id);
    setDeskCodeManual(true);
    setDesk({ siteId: item.site.id, code: item.code, name: item.name, isActive: item.isActive });
    setPanel("desk");
  };
  const openNewCallMessage = (targetSiteId?: string) => {
    setEditingCallMessageId(null);
    setCallMessage({ ...blankCallMessage(), siteId: targetSiteId || selectedSite || sites[0]?.site.id || "" });
    setPanel("call-message");
  };
  const openEditCallMessage = (item: any) => {
    setEditingCallMessageId(item.id);
    setCallMessage({ siteId: item.site.id, title: item.title, content: item.content, isActive: item.isActive });
    setPanel("call-message");
  };  const openEditService = (item: any) => {
    setEditingServiceId(item.id);
    setServiceCodeManual(true);
    setService({
      siteId: item.site.id,
      code: item.code,
      name: item.name,
      description: item.description ?? "",
      durationMinutes: item.durationMinutes,
      allowsOnlineBooking: item.allowsOnlineBooking,
      allowsQrCheckin: item.allowsQrCheckin,
      isActive: item.isActive,
    });
    setPanel("service");
  };

  if (!readable) return <main className="p-6"><EmptyState title={tr(fr, "Accès non autorisé", "Access not permitted")} description={tr(fr, "Demandez la permission Rendez-vous.", "Ask for the Appointments permission.")} /></main>;

  return <main className="mx-auto max-w-[1480px] space-y-6 p-4 sm:p-6 lg:p-8">
    <section className="relative isolate overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_20px_55px_-36px_rgb(15_118_110_/_0.7)]">
      <div className="relative grid gap-5 overflow-hidden bg-[radial-gradient(circle_at_82%_-25%,rgba(110,231,183,.32),transparent_38%),linear-gradient(125deg,#09372e,#0f766e)] px-6 py-8 text-white md:grid-cols-[1fr_auto] sm:px-8">
        <div className="relative max-w-3xl">
          <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[0.16em] text-emerald-50">{tr(fr, "ACCUEIL ET FILE D’ATTENTE", "APPOINTMENTS & QUEUE")}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{tr(fr, "Rendez-vous par site", "Site appointments")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/95">{tr(fr, "Réservations web, arrivée QR et file d’attente dans un seul espace sécurisé.", "Web bookings, QR arrivals and queue control in one secure workspace.")}</p>
        </div>
        {configurable && <div className="flex flex-wrap gap-2 self-end">
          <Button variant="secondary" onClick={() => { setPanel("visit"); setVisit({ ...blankVisit(), siteId: siteId || sites[0]?.site.id || "" }); }}><Plus className="size-4" />{tr(fr, "Rendez-vous", "Appointment")}</Button>
          <Button className="bg-white text-emerald-950 hover:bg-emerald-50" onClick={() => openNewService()}><Settings2 className="size-4" />{tr(fr, "Service", "Service")}</Button>
          <Button variant="secondary" onClick={openNewDesk}><Landmark className="size-4" />{tr(fr, "Guichet", "Desk")}</Button>
        </div>}
        {controllable && selectedSite && deskId && <div className="relative flex flex-col gap-3 rounded-2xl border border-white/20 bg-slate-950/20 p-4 shadow-inner sm:flex-row sm:items-end md:col-span-2">
          <div className="min-w-0 flex-1">
            <label className="text-xs font-semibold text-emerald-50" htmlFor="queue-call-message">{tr(fr, "Message au prochain visiteur", "Message to next visitor")}</label>
            <select id="queue-call-message" className="mt-2 h-10 w-full rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-medium text-white outline-none transition focus:border-white/55 focus:ring-2 focus:ring-white/20" value={messageTemplateId} onChange={(event) => setMessageTemplateId(event.target.value)}>
              <option value="" className="text-ink">{tr(fr, "Message standard", "Standard message")}</option>
              {activeCallMessages.map((item: any) => <option className="text-ink" key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-sm leading-5 text-white">{selectedCallMessage?.content || tr(fr, "Votre numéro est appelé. Veuillez vous présenter à l’accueil.", "Your ticket has been called. Please come to reception.")}</p>
            <p className="mt-1 text-[11px] leading-4 text-emerald-100">{tr(fr, "Les messages sont préparés par un administrateur du site et lus publiquement sur l’écran TV.", "Messages are prepared by a site administrator and read publicly on the TV display.")}</p>
          </div>
          <Button className="h-10 shrink-0 bg-white text-emerald-950 hover:bg-emerald-50" loading={callNext.isPending} onClick={() => callNext.mutate({ siteId: selectedSite, deskId, messageTemplateId: messageTemplateId || undefined })}><Send className="size-4" />{tr(fr, "Terminer et appeler", "Complete and call next")}</Button>
        </div>}
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden bg-border/80 sm:grid-cols-5">
        {[["waiting", "En attente", "Waiting", UsersRound], ["called", "Appelés", "Called", Send], ["serving", "En service", "Serving", CalendarCheck2], ["scheduled_today", "Prévus", "Scheduled", Clock3], ["completed_today", "Terminés", "Completed", CheckCircle2]].map(([key, french, english, Icon]: any) => <div key={key} className="group flex min-h-28 gap-3 bg-surface-1 p-4 transition-colors hover:bg-brand/[0.035] sm:p-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand transition-transform group-hover:scale-105"><Icon className="size-5" /></span><div className="pt-0.5"><b className="block text-2xl font-semibold tracking-tight text-ink">{summary.data?.[key] ?? 0}</b><p className="mt-1 text-xs font-medium text-ink-secondary">{tr(fr, french, english)}</p></div></div>)}
      </div>
    </section>

    {panel === "visit" && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, "Nouveau rendez-vous", "New appointment")}</CardTitle></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); createAppointment.mutate({ ...visit, serviceId: visit.serviceId || null, scheduledAt: new Date(visit.scheduledAt).toISOString() }); }}>
      <SelectField label="Site" value={visit.siteId} required items={sites.map((item: any) => [item.site.id, item.site.name])} onChange={(value) => setVisit((previous) => ({ ...previous, siteId: value, serviceId: "" }))} />
      <SelectField label={tr(fr, "Service", "Service")} value={visit.serviceId} items={availableServices.map((item: any) => [item.id, item.name])} onChange={(value) => setVisit((previous) => ({ ...previous, serviceId: value }))} />
      <FormField label={tr(fr, "Date et heure", "Date and time")} required><Input required type="datetime-local" value={visit.scheduledAt} onChange={(event) => setVisit((previous) => ({ ...previous, scheduledAt: event.target.value }))} /></FormField>
      <FormField label={tr(fr, "Nom", "Name")} required><Input required value={visit.visitorName} onChange={(event) => setVisit((previous) => ({ ...previous, visitorName: event.target.value }))} /></FormField>
      <FormField label="E-mail"><Input type="email" value={visit.visitorEmail} onChange={(event) => setVisit((previous) => ({ ...previous, visitorEmail: event.target.value }))} /></FormField>
      <FormField label={tr(fr, "Téléphone", "Phone")}><Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+243 800 000 000" value={visit.visitorPhone} onChange={(event) => setVisit((previous) => ({ ...previous, visitorPhone: event.target.value }))} /></FormField>
      <FormField className="md:col-span-3" label={tr(fr, "Motif", "Reason")}><Textarea value={visit.reason} onChange={(event) => setVisit((previous) => ({ ...previous, reason: event.target.value }))} /></FormField>
      <div className="md:col-span-3 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPanel(null)}>{tr(fr, "Annuler", "Cancel")}</Button><Button loading={createAppointment.isPending}>{tr(fr, "Créer", "Create")}</Button></div>
    </form></CardContent></Card></AppointmentModal>}

    {panel === "service" && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, editingServiceId ? "Modifier le service" : "Ajouter un service", editingServiceId ? "Edit service" : "Add service")}</CardTitle><CardDescription>{tr(fr, "Un service retiré reste dans l’historique des rendez-vous, mais ne peut plus être réservé.", "A retired service stays in appointment history but can no longer be booked.")}</CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); saveService.mutate(service); }}>
      <SelectField label="Site" value={service.siteId} required items={sites.map((item: any) => [item.site.id, item.site.name])} onChange={(value) => setService((previous) => ({ ...previous, siteId: value }))} />
      <FormField label={tr(fr, "Nom", "Name")} required><Input required value={service.name} onChange={(event) => { const name = event.target.value; setService((previous) => ({ ...previous, name, code: serviceCodeManual ? previous.code : serviceCodeFromName(name) })); }} /></FormField>
      <FormField label="Code" required><Input required value={service.code} placeholder="accueil_general" onChange={(event) => { setServiceCodeManual(true); setService((previous) => ({ ...previous, code: event.target.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "_") })); }} /><p className="mt-1 text-xs text-ink-secondary">{tr(fr, "Généré depuis le nom. Utilisez seulement des lettres minuscules, chiffres et _.", "Generated from the name. Use lowercase letters, numbers and _.")}</p></FormField>
      <FormField label={tr(fr, "Durée (minutes)", "Duration (minutes)")}><Input type="number" min="5" value={service.durationMinutes} onChange={(event) => setService((previous) => ({ ...previous, durationMinutes: Number(event.target.value) }))} /></FormField>
      <FormField className="md:col-span-2" label={tr(fr, "Description", "Description")}><Input value={service.description} onChange={(event) => setService((previous) => ({ ...previous, description: event.target.value }))} /></FormField>
      <div className="md:col-span-3 flex flex-wrap items-center gap-4 text-sm"><CheckOption checked={service.allowsOnlineBooking} label={tr(fr, "Réservation web", "Online booking")} onChange={(checked) => setService((previous) => ({ ...previous, allowsOnlineBooking: checked }))} /><CheckOption checked={service.allowsQrCheckin} label="QR" onChange={(checked) => setService((previous) => ({ ...previous, allowsQrCheckin: checked }))} /><div className="ml-auto flex gap-2"><Button type="button" variant="ghost" onClick={() => { setPanel(null); setEditingServiceId(null); }}>{tr(fr, "Annuler", "Cancel")}</Button><Button loading={saveService.isPending}>{tr(fr, editingServiceId ? "Enregistrer les modifications" : "Ajouter", editingServiceId ? "Save changes" : "Add")}</Button></div></div>
    </form></CardContent></Card></AppointmentModal>}

    {panel === "desk" && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, editingDeskId ? "Modifier le guichet" : "Ajouter un guichet", editingDeskId ? "Edit desk" : "Add desk")}</CardTitle><CardDescription>{tr(fr, "Tous les guichets utilisent une seule file pour ce site.", "All desks use one shared queue for this site.")}</CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const fallback = nextDeskDefaults(desk.siteId); saveDesk.mutate(editingDeskId ? desk : { ...desk, name: desk.name.trim() || fallback.name, code: desk.code.trim() || fallback.code }); }}><SelectField label="Site" value={desk.siteId} required items={sites.map((item: any) => [item.site.id, item.site.name])} onChange={(value) => setDesk((previous) => ({ ...previous, siteId: value }))} /><FormField label={tr(fr, "Nom du guichet", "Desk name")} required><Input required={Boolean(editingDeskId)} placeholder={tr(fr, "Ex. Guichet 1", "e.g. Desk 1")} value={desk.name} onChange={(event) => { const name = event.target.value; setDesk((previous) => ({ ...previous, name, code: deskCodeManual ? previous.code : serviceCodeFromName(name) })); }} /></FormField><FormField label="Code" required><Input required={Boolean(editingDeskId)} placeholder="desk_1" value={desk.code} onChange={(event) => { setDeskCodeManual(true); setDesk((previous) => ({ ...previous, code: event.target.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "_") })); }} /></FormField><div className="md:col-span-3 flex items-center justify-between gap-3"><CheckOption checked={desk.isActive} label={tr(fr, "Guichet actif", "Active desk")} onChange={(checked) => setDesk((previous) => ({ ...previous, isActive: checked }))} /><div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => { setPanel(null); setEditingDeskId(null); }}>{tr(fr, "Annuler", "Cancel")}</Button><Button loading={saveDesk.isPending}>{tr(fr, editingDeskId ? "Enregistrer les modifications" : "Ajouter le guichet", editingDeskId ? "Save changes" : "Add desk")}</Button></div></div></form></CardContent></Card></AppointmentModal>}
    {panel === "call-message" && <AppointmentModal><CallMessageEditor item={callMessage} sites={sites} fr={fr} saving={saveCallMessage.isPending} onCancel={() => { setPanel(null); setEditingCallMessageId(null); setCallMessage(blankCallMessage()); }} onSave={(payload: any) => saveCallMessage.mutate(payload)} /></AppointmentModal>}
    <section className="grid gap-6 xl:grid-cols-[1.4fr_.85fr]">
      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]"><CardHeader className="gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{tr(fr, "File commune", "Shared queue")}</CardTitle><CardDescription className="mt-1">{tr(fr, "Tous les guichets appellent la prochaine personne de cette même liste.", "Every desk calls the next visitor from this same list.")}</CardDescription></div><select className="control h-10 max-w-56 bg-surface-1 shadow-sm" value={siteId} onChange={(event) => { setSiteId(event.target.value); setDeskId(""); setMessageTemplateId(""); setUpcomingOffset(0); }}><option value="">{tr(fr, "Tous les sites", "All sites")}</option>{sites.map((item: any) => <option key={item.site.id} value={item.site.id}>{item.site.name}</option>)}</select>{selectedSite && <select className="control h-10 max-w-56 bg-surface-1 shadow-sm" value={deskId} onChange={(event) => setDeskId(event.target.value)}><option value="">{availableDesks.length ? tr(fr, "Choisissez votre guichet", "Choose your desk") : tr(fr, "Ajoutez un guichet", "Add a desk")}</option>{availableDesks.map((item: any) => <option key={item.id} value={item.id} disabled={Boolean(item.activeMember && !item.isCurrentOperator)}>{item.name}{item.activeMember ? ` · ${item.activeMember.name}` : ""}</option>)}</select>}</CardHeader>
        <CardContent className="space-y-3 p-5">
          

          {appointments.isLoading ? <SkeletonCard /> : appointments.isError ? <ErrorState description={(appointments.error as Error).message} onRetry={() => void appointments.refetch()} /> : live.length ? live.map((row: any) => <QueueRow key={row.id} row={row} fr={fr} controls={controllable} deskId={deskId} siteId={selectedSite} messageTemplateId={messageTemplateId} callNext={callNext} transition={transition} />) : <EmptyState icon={UsersRound} title={tr(fr, "La file est vide", "Queue is empty")} />}
          {controllable && !selectedSite && <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4"><p className="text-sm font-semibold text-ink">{tr(fr, "Sélectionnez d’abord un site", "Select a site first")}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Choisissez le site dans le filtre ci-dessus, puis votre guichet. La personne suivante sera toujours prise dans la même file du site.", "Choose the site above, then your desk. The next visitor will always be taken from that site’s one shared queue.")}</p></div>}
{controllable && selectedSite && !availableDesks.length && <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4"><p className="text-sm font-semibold text-ink">{tr(fr, "Ajoutez un guichet avant d’appeler", "Add a desk before calling")}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Un guichet identifie l’agent qui appelle, sans séparer les visiteurs en plusieurs files.", "A desk identifies the calling agent without splitting visitors into separate queues.")}</p>{configurable && <Button size="sm" className="mt-3" variant="secondary" onClick={openNewDesk}><Plus className="size-4" />{tr(fr, "Ajouter un guichet", "Add desk")}</Button>}</div>}
{controllable && selectedSite && availableDesks.length > 0 && !deskId && <div className="rounded-2xl border border-brand/20 bg-brand/[0.05] p-4"><p className="text-sm font-semibold text-ink">{tr(fr, "Choisissez votre guichet", "Choose your desk")}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Utilisez le deuxième menu en haut de la file. Ensuite, Appeler fonctionnera immédiatement.", "Use the second menu above the queue. Then Call will work immediately.")}</p></div>}

        </CardContent>
      </Card>
      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]"><CardHeader className="border-b border-border/70 bg-surface-2/45 px-5 py-5"><div><CardTitle>{tr(fr, "Rendez-vous prévus", "Upcoming appointments")}</CardTitle><CardDescription className="mt-1">{tr(fr, "Les prochaines arrivées à préparer. Affichés par groupes de 10 pour garder la page rapide.", "The next arrivals to prepare. Shown in groups of 10 to keep the page fast.")}</CardDescription></div></CardHeader><CardContent className="space-y-3 p-5">{upcomingAppointments.isLoading ? <SkeletonCard /> : upcomingAppointments.isError ? <ErrorState description={(upcomingAppointments.error as Error).message} onRetry={() => void upcomingAppointments.refetch()} /> : upcoming.length ? <>{upcoming.map((row: any) => <div key={row.id} className="group flex items-center justify-between gap-3 rounded-2xl border border-brand/20 bg-surface-1 p-4 ring-1 ring-brand/[0.035] shadow-sm transition hover:border-brand/40 hover:shadow-[0_12px_26px_-24px_rgb(15_118_110_/_0.65)]"><div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Clock3 className="size-5" /></span><div className="min-w-0"><b className="block truncate text-sm font-semibold text-ink">{row.visitor.name}</b><p className="mt-1 truncate text-xs text-ink-secondary">{row.service?.name ?? "—"} · {row.site.name}{row.desk?.name ? ` · ${row.desk.name}` : ""}</p>{row.reference ? <p className="mt-1 text-[11px] font-semibold tracking-wide text-brand">{row.reference}</p> : null}</div></div>{controllable && <Button size="sm" variant="secondary" loading={checkIn.isPending} onClick={() => checkIn.mutate(row.id)}>{tr(fr, "Arrivé", "Check in")}</Button>}</div>)}<div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3"><Button size="sm" variant="secondary" disabled={!upcomingOffset} onClick={() => setUpcomingOffset((value) => Math.max(0, value - 10))}><ChevronLeft className="size-4" />{tr(fr, "Précédents", "Previous")}</Button><p className="text-xs font-medium text-ink-secondary">{tr(fr, `Résultats ${upcomingOffset + 1}–${upcomingOffset + upcoming.length}`, `Results ${upcomingOffset + 1}–${upcomingOffset + upcoming.length}`)}</p><Button size="sm" variant="secondary" disabled={!upcomingPage?.hasMore} onClick={() => setUpcomingOffset(upcomingPage.nextOffset)}>{tr(fr, "Suivants", "Next")}<ChevronRight className="size-4" /></Button></div></> : <EmptyState icon={Clock3} title={tr(fr, "Aucun rendez-vous à venir", "No upcoming appointments")} />}</CardContent></Card>
    </section>

    <section className="grid gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]"><CardHeader className="border-b border-border/70 bg-surface-2/45 px-5 py-5"><CardTitle>{tr(fr, "Canaux par site", "Site channels")}</CardTitle><CardDescription className="mt-1">{tr(fr, "Un lien web, un QR d’arrivée et un écran TV peuvent être activés séparément pour chaque site.", "Web booking, QR arrival and TV display can be enabled separately for each site.")}</CardDescription></CardHeader><CardContent className="space-y-4 p-5">{settings.isLoading ? <SkeletonCard /> : sites.map((item: any) => <SiteChannel key={item.site.id} item={item} orgSlug={orgSlug} fr={fr} configurable={ownerOnlyConfiguration} hasOnlineService={(services.data ?? []).some((service: any) => service.site.id === item.site.id && service.isActive && service.allowsOnlineBooking)} onConfigure={() => setSettingsOpen(item)} />)}</CardContent></Card>
      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]">
        <CardHeader className="gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle>{tr(fr, "Services par site", "Services by site")}</CardTitle><CardDescription className="mt-1">{tr(fr, "Chaque site garde ses propres services. Ajoutez, modifiez ou retirez un service directement dans le bon site.", "Each site keeps its own services. Add, edit, or retire a service directly within the right site.")}</CardDescription></div>
          {configurable && <Button size="sm" variant="secondary" onClick={() => openNewService()}><Plus />{tr(fr, "Ajouter un service", "Add service")}</Button>}
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {services.isLoading ? <SkeletonCard /> : serviceGroups.length ? serviceGroups.map((group) => <section key={group.site.id} className="overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 ring-1 ring-brand/[0.025]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-surface-2/45 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Landmark className="size-4" /></span><div className="min-w-0"><b className="block truncate text-sm font-semibold text-ink">{group.site.name}</b><p className="mt-0.5 text-xs text-ink-secondary">{group.site.provinceName ?? tr(fr, "Site de l’entreprise", "Company site")}</p></div></div><div className="flex items-center gap-2"><Badge variant="neutral">{group.services.length} {tr(fr, group.services.length === 1 ? "service" : "services", group.services.length === 1 ? "service" : "services")}</Badge>{configurable && <Button type="button" size="sm" variant="secondary" onClick={() => openNewService(group.site.id)}><Plus />{tr(fr, "Ajouter", "Add")}</Button>}</div></header>
            <div className="space-y-2 p-3">{group.services.length ? group.services.map((item: any) => <div key={item.id} className="group flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/75 bg-surface-1 px-3 py-3 transition hover:border-brand/35 hover:bg-brand/[0.025]"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><CalendarCheck2 className="size-4" /></span><div className="min-w-0"><b className="block truncate text-sm font-semibold text-ink">{item.name}</b><p className="mt-1 text-xs text-ink-secondary">{item.durationMinutes} {tr(fr, "min", "min")}</p></div></div><div className="ml-auto flex flex-wrap items-center justify-end gap-2">{item.allowsOnlineBooking && <Badge variant="info">Web</Badge>}{item.allowsQrCheckin && <Badge variant="good">QR</Badge>}{controllable && <><Button type="button" size="sm" variant="secondary" title={tr(fr, "Modifier ce service", "Edit this service")} onClick={() => openEditService(item)}><Pencil />{tr(fr, "Modifier", "Edit")}</Button><Button type="button" size="sm" variant="ghost" className="text-critical hover:bg-critical/10 hover:text-critical" title={tr(fr, "Supprimer ce service", "Delete this service")} onClick={() => setServiceToDeactivate(item)}><Trash2 />{tr(fr, "Supprimer", "Delete")}</Button></>}</div></div>) : <div className="rounded-xl border border-dashed border-border bg-surface-2/30 px-4 py-4 text-sm text-ink-secondary">{tr(fr, "Aucun service pour ce site.", "No services for this site.")}</div>}</div>
          </section>) : <EmptyState title={tr(fr, "Aucun site configuré", "No configured site")} description={tr(fr, "Configurez d’abord un site pour lui ajouter des services.", "Configure a site before adding services.")} />}
        </CardContent>
      </Card>
    </section>


    <section>
      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]">
        <CardHeader className="gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle>{tr(fr, "Guichets de la file commune", "Shared-queue desks")}</CardTitle><CardDescription className="mt-1">{tr(fr, "Créez les postes d’accueil de ce site. Chaque agent appelle le prochain numéro disponible de la même file.", "Create reception workstations for this site. Each agent calls the next available ticket from the same queue.")}</CardDescription></div>
          {configurable && <Button size="sm" variant="secondary" onClick={openNewDesk}><Plus />{tr(fr, "Ajouter un guichet", "Add desk")}</Button>}
        </CardHeader>
        <CardContent className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {desks.isLoading ? <SkeletonCard /> : displayedDesks.length ? displayedDesks.map((item: any) => <div key={item.id} className={`rounded-2xl border p-4 shadow-sm transition ${deskId === item.id ? "border-brand bg-brand/[0.055] ring-1 ring-brand/20" : "border-brand/20 bg-surface-1 hover:border-brand/40"}`}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Landmark className="size-5" /></span><div className="min-w-0"><b className="block truncate text-sm text-ink">{item.name}</b><p className="mt-1 truncate text-xs text-ink-secondary">{item.site.name}</p></div></div><Badge variant={item.activeMember ? "info" : "good"}>{item.activeMember ? tr(fr, "Occupé", "In use") : tr(fr, "Disponible", "Available")}</Badge></div><p className="mt-4 min-h-5 text-xs text-ink-secondary">{item.activeMember ? tr(fr, `Utilisé par ${item.activeMember.name}`, `Used by ${item.activeMember.name}`) : tr(fr, "Aucun agent ne l’utilise actuellement", "No agent is using it yet")}</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant={deskId === item.id ? "secondary" : "outline"} disabled={Boolean(item.activeMember && !item.isCurrentOperator && deskId !== item.id)} onClick={() => { setSiteId(item.site.id); setDeskId(item.id); }}>{deskId === item.id ? tr(fr, "Guichet sélectionné", "Desk selected") : tr(fr, "Utiliser ce guichet", "Use this desk")}</Button>{controllable && item.activeMember && <Button type="button" size="sm" variant="ghost" loading={releaseDesk.isPending} onClick={() => releaseDesk.mutate(item.id)}>{tr(fr, "Libérer", "Release")}</Button>}{controllable && <Button type="button" size="sm" variant="ghost" onClick={() => openEditDesk(item)}><Pencil />{tr(fr, "Modifier", "Edit")}</Button>}{controllable && <Button type="button" size="sm" variant="ghost" className="text-critical hover:bg-critical/10 hover:text-critical" onClick={() => setDeskToDeactivate(item)}><Trash2 />{tr(fr, "Retirer", "Remove")}</Button>}</div></div>) : <EmptyState icon={Landmark} title={tr(fr, "Aucun guichet", "No desks")} description={tr(fr, "Ajoutez un guichet pour permettre à plusieurs agents de prendre la prochaine personne de la file commune.", "Add a desk so several agents can take the next visitor from one shared queue.")} action={configurable ? { label: tr(fr, "Ajouter un guichet", "Add desk"), onClick: openNewDesk } : undefined} />}
        </CardContent>
      </Card>
    </section>

    {callMessageToDeactivate && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, "Retirer ce message d’appel ?", "Remove this call message?")}</CardTitle><CardDescription>{tr(fr, "Les agents ne pourront plus le sélectionner. Les appels déjà effectués garderont le message qui leur était associé.", "Agents will no longer be able to select it. Calls already made will keep their associated message.")}</CardDescription></CardHeader><CardContent className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => setCallMessageToDeactivate(null)}>{tr(fr, "Annuler", "Cancel")}</Button><Button variant="destructive" loading={deactivateCallMessage.isPending} onClick={() => deactivateCallMessage.mutate(callMessageToDeactivate.id)}><Trash2 />{tr(fr, "Retirer le message", "Remove message")}</Button></CardContent></Card></AppointmentModal>}    {deskToDeactivate && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, "Retirer ce guichet ?", "Remove this desk?")}</CardTitle><CardDescription>{tr(fr, "Le guichet ne pourra plus appeler de visiteurs. Les rendez-vous déjà servis conserveront leur historique.", "The desk will no longer call visitors. Already-served appointments will keep their history.")}</CardDescription></CardHeader><CardContent className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeskToDeactivate(null)}>{tr(fr, "Annuler", "Cancel")}</Button><Button variant="destructive" loading={deactivateDesk.isPending} onClick={() => deactivateDesk.mutate(deskToDeactivate.id)}><Trash2 />{tr(fr, "Retirer le guichet", "Remove desk")}</Button></CardContent></Card></AppointmentModal>}
    {serviceToDeactivate && <AppointmentModal><Card className="border-0 shadow-none"><CardHeader><CardTitle>{tr(fr, "Supprimer ce service ?", "Delete this service?")}</CardTitle><CardDescription>{tr(fr, "Le service sera retiré des réservations web et QR. Les rendez-vous déjà créés seront conservés dans l’historique.", "The service will be removed from web and QR bookings. Existing appointments will remain in history.")}</CardDescription></CardHeader><CardContent className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => setServiceToDeactivate(null)}>{tr(fr, "Annuler", "Cancel")}</Button><Button variant="destructive" loading={deactivateService.isPending} onClick={() => deactivateService.mutate(serviceToDeactivate.id)}><Trash2 />{tr(fr, "Supprimer le service", "Delete service")}</Button></CardContent></Card></AppointmentModal>}    {settingsOpen && <AppointmentModal><SettingsEditor orgSlug={orgSlug} item={settingsOpen} fr={fr} saving={saveSettings.isPending} messages={(callMessages.data ?? []).filter((message: any) => message.site.id === settingsOpen.site.id)} messageAdmin={ownerOnlyConfiguration} onCancel={() => setSettingsOpen(null)} onSave={(payload: any) => saveSettings.mutate(payload)} onAddMessage={() => { const targetSiteId = settingsOpen.site.id; setSettingsOpen(null); openNewCallMessage(targetSiteId); }} onEditMessage={(message: any) => { setSettingsOpen(null); openEditCallMessage(message); }} onRemoveMessage={(message: any) => { setSettingsOpen(null); setCallMessageToDeactivate(message); }} /></AppointmentModal>}
  </main>;
}

function FormField({ label, children, required, className }: { label: string; children: React.ReactNode; required?: boolean; className?: string }) { return <Field className={className} label={label} required={required}>{children}</Field>; }
function SelectField({ label, value, items, onChange, required }: { label: string; value: string; items: [string, string][]; onChange: (value: string) => void; required?: boolean }) { return <FormField label={label} required={required}><select className="control" value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{items.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>; }
function CheckOption({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }

function ChannelOption({ checked, title, description, onChange }: { checked: boolean; title: string; description: string; onChange: (value: boolean) => void }) {
  return <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${checked ? "border-brand bg-brand/5" : "border-border bg-surface-2/40"}`}><input className="mt-0.5 size-4 accent-[var(--color-brand)]" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b className="block text-sm text-ink">{title}</b><span className="mt-1 block text-xs leading-5 text-ink-secondary">{description}</span></span></label>;
}

function AppointmentModal({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6" role="presentation"><section className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:rounded-3xl" role="dialog" aria-modal="true">{children}</section></div>;
}

function QueueRow({ row, fr, controls, deskId, siteId, messageTemplateId, callNext, transition }: any) {
  const status = row.status === "serving" ? "good" : row.status === "called" ? "info" : "warning";
  return <div className="group flex flex-wrap items-center gap-3 rounded-2xl border border-brand/20 bg-surface-1 p-4 ring-1 ring-brand/[0.035] shadow-sm transition hover:border-brand/40 hover:shadow-[0_12px_26px_-24px_rgb(15_118_110_/_0.65)]"><b className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/10 text-base font-semibold text-brand">#{row.queue?.number ?? "—"}</b><div className="min-w-48 flex-1"><p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{row.visitor.name} <Badge variant={status as any}>{row.status}</Badge></p><p className="mt-1 text-xs text-ink-secondary">{row.service?.name ?? "—"} · {row.site.name}{row.desk?.name ? ` · ${row.desk.name}` : ""}</p></div>{controls && <div className="flex gap-2">{["waiting", "checked_in"].includes(row.status) && <Button size="sm" variant="secondary" disabled={!deskId} onClick={() => callNext.mutate({ siteId, deskId, messageTemplateId: messageTemplateId || undefined })}>{tr(fr, "Appeler", "Call")}</Button>}{row.status === "called" && <Button size="sm" disabled={!deskId} onClick={() => transition.mutate({ id: row.id, status: "serving", deskId })}>{tr(fr, "Démarrer", "Start")}</Button>}{row.status === "serving" && <Button size="sm" disabled={!deskId} onClick={() => transition.mutate({ id: row.id, status: "completed", deskId })}>{tr(fr, "Terminer", "Complete")}</Button>}</div>}</div>;
}

function SiteChannel({ item, orgSlug, fr, configurable, hasOnlineService, onConfigure }: any) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const bookingUrl = `${origin}/book/${orgSlug}?site=${item.site.code}`;
  const checkInUrl = `${origin}/check-in/${orgSlug}/${item.site.code}?token=${item.checkinToken}`;
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); };
  return <div className="group relative overflow-hidden rounded-2xl border border-brand/25 bg-surface-1 p-5 ring-1 ring-brand/[0.04] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_16px_34px_-28px_rgb(15_118_110_/_0.75)]"><div className="absolute inset-y-0 left-0 w-1 bg-brand/55" /><div className="flex flex-wrap justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><CalendarCheck2 className="size-5" /></span><div className="min-w-0"><b className="block truncate text-sm font-semibold text-ink">{item.site.name}</b><p className="mt-1 text-xs text-ink-secondary">{item.site.provinceName} · {item.bookingOpensAt}–{item.bookingClosesAt}</p></div></div>{configurable && <Button size="sm" variant="secondary" onClick={onConfigure}><Settings2 className="size-4" />{tr(fr, "Configurer", "Configure")}</Button>}</div><div className="mt-4 flex flex-wrap gap-2 border-y border-border/70 py-3">{item.publicBookingEnabled && <Badge variant="good">Web</Badge>}{item.qrCheckinEnabled && <Badge variant="info">QR</Badge>}{item.queueDisplayEnabled && <Badge variant="good">TV</Badge>}{!item.publicBookingEnabled && !item.qrCheckinEnabled && !item.queueDisplayEnabled && <span className="text-xs font-medium text-ink-secondary">{tr(fr, "Aucun canal activé", "No channel enabled")}</span>}</div>{item.publicBookingEnabled && !hasOnlineService && <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-100">{tr(fr, "La réservation web est activée, mais aucun service actif n’autorise encore le Web. Ajoutez un service puis cochez Réservation web.", "Online booking is enabled, but no active service currently allows web booking. Add a service and enable Online booking.")}</p>}{configurable && <div className="mt-4 grid gap-4 lg:grid-cols-[170px_1fr]"><div className="rounded-xl border border-border/70 bg-surface-2/35 p-2">{item.qrCheckinEnabled && item.checkinToken ? <SiteQr value={checkInUrl} label={tr(fr, `QR d’arrivée · ${item.site.name}`, `Check-in QR · ${item.site.name}`)} printTitle={tr(fr, `Arrivée · ${item.site.name}`, `Check in · ${item.site.name}`)} printLabel={tr(fr, "Imprimer le QR", "Print QR")} /> : <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border text-center text-xs text-ink-secondary">{tr(fr, "Activez le QR pour l’afficher.", "Enable QR to display it.")}</div>}</div><div className="grid content-center gap-2 sm:grid-cols-3"><Button size="sm" variant="secondary" disabled={!item.publicBookingEnabled} onClick={() => void copy(bookingUrl)}><ClipboardCopy className="size-4" />{copied ? tr(fr, "Copié", "Copied") : tr(fr, "Lien web", "Web link")}</Button><Button size="sm" variant="secondary" disabled={!item.qrCheckinEnabled || !item.checkinToken} onClick={() => void copy(checkInUrl)}><ClipboardCopy className="size-4" />{tr(fr, "Lien QR", "QR link")}</Button><a className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium ${item.queueDisplayEnabled ? "border-border bg-surface-1 text-ink shadow-sm hover:bg-surface-2" : "pointer-events-none opacity-40"}`} href={`/queue/${orgSlug}/${item.site.code}`} target="_blank" rel="noreferrer"><MonitorPlay className="size-4" />TV</a></div></div>}</div>;
}

function CallMessageEditor({ item, sites, fr, saving, onSave, onCancel }: any) {
  const [state, setState] = useState(item);
  const settingsPayload = (value: any) => ({
    siteId: item.site.id,
    publicBookingEnabled: value.publicBookingEnabled,
    qrCheckinEnabled: value.qrCheckinEnabled,
    queueDisplayEnabled: value.queueDisplayEnabled,
    bookingOpensAt: value.bookingOpensAt,
    bookingClosesAt: value.bookingClosesAt,
    slotIntervalMinutes: Number(value.slotIntervalMinutes),
    defaultServiceMinutes: Number(value.defaultServiceMinutes),
    welcomeMessage: value.welcomeMessage,
    idleDisplayTitle: value.idleDisplayTitle,
    idleDisplayMessage: value.idleDisplayMessage,
    idleDisplayDocumentId: value.idleDisplayDocumentId,
  });
  return <Card className="border-brand/35"><CardHeader><CardTitle>{tr(fr, state.title ? "Modifier le message d’appel" : "Ajouter un message d’appel", state.title ? "Edit call message" : "Add call message")}</CardTitle><CardDescription>{tr(fr, "Ce texte est public : il peut être lu à voix haute et affiché sur la TV. N’ajoutez aucune information privée sur un visiteur.", "This text is public: it may be read aloud and displayed on TV. Do not include visitor-private information.")}</CardDescription></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave(state); }}>
    <SelectField label={tr(fr, "Site", "Site")} value={state.siteId} required items={sites.map((site: any) => [site.site.id, site.site.name])} onChange={(value) => setState((previous: any) => ({ ...previous, siteId: value }))} />
    <FormField label={tr(fr, "Nom interne", "Internal name")} required><Input required maxLength={100} placeholder={tr(fr, "Ex. Accueil avec pièce d’identité", "e.g. Welcome with ID")} value={state.title} onChange={(event) => setState((previous: any) => ({ ...previous, title: event.target.value }))} /><p className="mt-1 text-xs text-ink-secondary">{tr(fr, "Ce nom apparaît seulement pour les agents.", "Only agents see this name.")}</p></FormField>
    <FormField className="md:col-span-2" label={tr(fr, "Message public", "Public message")} required><Textarea required maxLength={500} rows={4} placeholder={tr(fr, "Ex. Bienvenue. Présentez-vous au guichet avec votre pièce d’identité.", "e.g. Welcome. Please come to the desk with your ID.")} value={state.content} onChange={(event) => setState((previous: any) => ({ ...previous, content: event.target.value }))} /><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Maximum 500 caractères. Chaque site peut garder jusqu’à cinq messages actifs, en plus du message standard.", "Maximum 500 characters. Each site can keep up to five active messages, in addition to the standard message.")}</p></FormField>
    <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3"><CheckOption checked={state.isActive} label={tr(fr, "Disponible pour les agents", "Available to agents")} onChange={(isActive) => setState((previous: any) => ({ ...previous, isActive }))} /><div className="flex gap-2"><Button type="button" variant="ghost" onClick={onCancel}>{tr(fr, "Annuler", "Cancel")}</Button><Button loading={saving}>{tr(fr, "Enregistrer le message", "Save message")}</Button></div></div>
  </form></CardContent></Card>;
}

function SettingsEditor({ orgSlug, item, fr, saving, messages, messageAdmin, onSave, onCancel, onAddMessage, onEditMessage, onRemoveMessage }: any) {
  const [state, setState] = useState({ ...item, bookingOpensAt: item.bookingOpensAt || "08:00", bookingClosesAt: item.bookingClosesAt || "17:00", slotIntervalMinutes: item.slotIntervalMinutes || 30, defaultServiceMinutes: item.defaultServiceMinutes || 20, welcomeMessage: item.welcomeMessage ?? "", idleDisplayTitle: item.idleDisplayTitle ?? "", idleDisplayMessage: item.idleDisplayMessage ?? "", idleDisplayDocumentId: item.idleDisplayDocument?.id ?? null, idleDisplayDocument: item.idleDisplayDocument ?? null });
  const uploadIdleVideo = useMutation({ mutationFn: async (file: File) => { if (!["video/mp4", "video/webm"].includes(file.type)) throw new Error(tr(fr, "Choisissez une vidéo MP4 ou WebM.", "Choose an MP4 or WebM video.")); const data = new FormData(); data.set("file", file); data.set("title", file.name.replace(/\.[^.]+$/, "")); data.set("category", "general"); data.set("siteId", item.site.id); return (await api.post(orgUrl(orgSlug, "documents"), data, { headers: { "Content-Type": "multipart/form-data" } })).data.document; }, onSuccess: (document: any) => { setState((previous: any) => ({ ...previous, idleDisplayDocumentId: document.id, idleDisplayDocument: document })); toast.success(tr(fr, "Vidéo ajoutée. Enregistrez la configuration pour la diffuser sur la TV.", "Video uploaded. Save the configuration to show it on TV.")); }, onError: (error: Error) => toast.error(error.message) });
  const settingsPayload = (value: any) => ({
    siteId: item.site.id,
    publicBookingEnabled: value.publicBookingEnabled,
    qrCheckinEnabled: value.qrCheckinEnabled,
    queueDisplayEnabled: value.queueDisplayEnabled,
    bookingOpensAt: value.bookingOpensAt,
    bookingClosesAt: value.bookingClosesAt,
    slotIntervalMinutes: Number(value.slotIntervalMinutes),
    defaultServiceMinutes: Number(value.defaultServiceMinutes),
    welcomeMessage: value.welcomeMessage,
    idleDisplayTitle: value.idleDisplayTitle,
    idleDisplayMessage: value.idleDisplayMessage,
    idleDisplayDocumentId: value.idleDisplayDocumentId,
  });
  return <Card className="border-brand/35"><CardHeader><CardTitle>{tr(fr, "Configurer ", "Configure ")}{item.site.name}</CardTitle><CardDescription>{tr(fr, "Activez uniquement les canaux que ce site est prêt à recevoir.", "Enable only the channels this site is ready to receive.")}</CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); if (!state.bookingOpensAt || !state.bookingClosesAt || state.bookingClosesAt <= state.bookingOpensAt) { toast.error(tr(fr, "Choisissez une fermeture postérieure à l’ouverture.", "Choose a closing time later than the opening time.")); return; } onSave(settingsPayload(state)); }}>
    <FormField label={tr(fr, "Ouverture", "Opening")}><Input required type="time" value={state.bookingOpensAt} onChange={(event) => setState((previous: any) => ({ ...previous, bookingOpensAt: event.target.value }))} /></FormField>
    <FormField label={tr(fr, "Fermeture", "Closing")}><Input required type="time" value={state.bookingClosesAt} onChange={(event) => setState((previous: any) => ({ ...previous, bookingClosesAt: event.target.value }))} /></FormField>
    <FormField label={tr(fr, "Intervalle", "Interval")}><Input type="number" min="5" value={state.slotIntervalMinutes} onChange={(event) => setState((previous: any) => ({ ...previous, slotIntervalMinutes: event.target.value }))} /></FormField>
    <FormField label={tr(fr, "Durée", "Duration")}><Input type="number" min="5" value={state.defaultServiceMinutes} onChange={(event) => setState((previous: any) => ({ ...previous, defaultServiceMinutes: event.target.value }))} /></FormField>
    <FormField className="md:col-span-4" label={tr(fr, "Message d’accueil", "Welcome message")}><Textarea value={state.welcomeMessage} onChange={(event) => setState((previous: any) => ({ ...previous, welcomeMessage: event.target.value }))} /><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Ce message général apparaît à la réservation et à l’arrivée QR. Il n’est pas le message lu lorsqu’un numéro est appelé.", "This general message appears in booking and QR check-in. It is not the message read when a ticket is called.")}</p></FormField>
    <div className="md:col-span-4 grid gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.035] p-4 sm:grid-cols-[.8fr_1.2fr]"><FormField label={tr(fr, "Titre lorsque la file est vide", "Empty-queue title")}><Input maxLength={120} placeholder={tr(fr, "Ex. Bienvenue à Congo Omega", "e.g. Welcome to Congo Omega")} value={state.idleDisplayTitle} onChange={(event) => setState((previous: any) => ({ ...previous, idleDisplayTitle: event.target.value }))} /></FormField><FormField label={tr(fr, "Message lorsque la file est vide", "Empty-queue message")}><Textarea maxLength={600} rows={3} placeholder={tr(fr, "Ex. Nous sommes prêts à vous accueillir. Présentez-vous au guichet ou scannez le QR code.", "e.g. We are ready to welcome you. Please come to reception or scan the QR code.")} value={state.idleDisplayMessage} onChange={(event) => setState((previous: any) => ({ ...previous, idleDisplayMessage: event.target.value }))} /><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Ce contenu animé apparaît uniquement sur la TV lorsqu’il n’y a aucun numéro en attente ni en cours.", "This animated content appears only on the TV when no ticket is waiting or being served.")}</p></FormField></div><div className="md:col-span-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.035] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{tr(fr, "Vidéo lorsque la file est vide", "Empty-queue video")}</p><p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">{tr(fr, "Ajoutez une courte vidéo MP4 ou WebM. Elle est diffusée automatiquement, sans son, uniquement sur la TV lorsque personne n’attend et qu’aucun numéro n’est appelé.", "Add a short MP4 or WebM video. It plays automatically without sound only on the TV when nobody is waiting and no ticket is called.")}</p></div>{state.idleDisplayDocument ? <Button type="button" size="sm" variant="ghost" loading={saving} onClick={() => { const next = { ...state, idleDisplayDocumentId: null, idleDisplayDocument: null }; setState(next); onSave(settingsPayload(next)); }}><Trash2 />{tr(fr, "Retirer la vidéo", "Remove video")}</Button> : null}</div><div className="mt-4 flex flex-wrap items-center gap-3"><input aria-label={tr(fr, "Téléverser une vidéo pour la TV", "Upload a video for the TV")} type="file" accept="video/mp4,video/webm" className="block max-w-full text-xs text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand hover:file:bg-brand/15" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) uploadIdleVideo.mutate(file); }} />{uploadIdleVideo.isPending ? <span className="text-xs font-medium text-brand">{tr(fr, "Téléversement…", "Uploading…")}</span> : null}{state.idleDisplayDocument ? <span className="rounded-full border border-violet-500/20 bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink">{state.idleDisplayDocument.title ?? state.idleDisplayDocument.fileName}</span> : <span className="text-xs text-ink-secondary">{tr(fr, "Aucune vidéo sélectionnée", "No video selected")}</span>}</div></div>    <div className="md:col-span-4 rounded-2xl border border-brand/20 bg-brand/[0.035] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{tr(fr, "Messages d’appel TV", "TV call messages")}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{tr(fr, "Les agents choisissent l’un de ces messages lorsqu’ils appellent un visiteur. Le texte est affiché et lu publiquement sur la TV.", "Agents choose one of these messages when calling a visitor. The text is displayed and read publicly on TV.")}</p></div>{messageAdmin && <Button type="button" size="sm" variant="secondary" onClick={onAddMessage}><Plus />{tr(fr, "Ajouter", "Add")}</Button>}</div><div className="mt-3 space-y-2">{messages.length ? messages.map((message: any) => <div key={message.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface-1 px-3 py-3"><div className="min-w-0"><b className="block text-sm text-ink">{message.title}</b><p className="mt-1 text-xs leading-5 text-ink-secondary">{message.content}</p></div>{messageAdmin && <div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => onEditMessage(message)}><Pencil />{tr(fr, "Modifier", "Edit")}</Button><Button type="button" size="sm" variant="ghost" className="text-critical hover:bg-critical/10 hover:text-critical" onClick={() => onRemoveMessage(message)}><Trash2 />{tr(fr, "Retirer", "Remove")}</Button></div>}</div>) : <p className="rounded-xl border border-dashed border-border bg-surface-1 px-3 py-3 text-xs leading-5 text-ink-secondary">{tr(fr, "Aucun message personnalisé : les agents utiliseront le message standard.", "No custom messages: agents will use the standard message.")}</p>}</div></div>
    <div className="md:col-span-4 grid gap-3 sm:grid-cols-3"><ChannelOption checked={state.publicBookingEnabled} title={tr(fr, "Réservation en ligne", "Online booking")} description={tr(fr, "Permet aux visiteurs de choisir un créneau depuis /rendez-vous.", "Lets visitors choose a time from /rendez-vous.")} onChange={(value) => setState((previous: any) => ({ ...previous, publicBookingEnabled: value }))} /><ChannelOption checked={state.qrCheckinEnabled} title={tr(fr, "Arrivée avec QR", "QR check-in")} description={tr(fr, "Affiche et imprime le QR pour prendre un numéro de file sur place.", "Shows and prints a QR code for on-site queue tickets.")} onChange={(value) => setState((previous: any) => ({ ...previous, qrCheckinEnabled: value }))} /><ChannelOption checked={state.queueDisplayEnabled} title={tr(fr, "Écran de file TV", "Queue TV display")} description={tr(fr, "Affiche uniquement les numéros appelés, sans données privées.", "Shows called ticket numbers only, without private details.")} onChange={(value) => setState((previous: any) => ({ ...previous, queueDisplayEnabled: value }))} /></div>
    <div className="md:col-span-4 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>{tr(fr, "Fermer", "Close")}</Button><Button loading={saving}>{tr(fr, "Enregistrer", "Save")}</Button></div>
  </form></CardContent></Card>;
}