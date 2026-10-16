"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  KeyRound,
  Clock3,
  Headphones,
  Mail,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { PublicMarketingAnalytics, trackMarketingEvent } from "@/components/analytics/public-marketing-analytics";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { ApiError, post } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Category =
  "general" | "access" | "technical" | "billing" | "demo" | "privacy" | "other";

const copy = {
  fr: {
    eyebrow: "CONTACT LITEHUBS",
    title: "Parlons de votre exploitation.",
    description:
      "Une question, une démonstration, un problème d’accès ou une demande sur vos données : écrivez-nous. Votre demande arrive directement à l’équipe LiteHubs et vous recevez une confirmation par e-mail.",
    back: "Retour à la connexion",
    name: "Nom complet",
    email: "E-mail de réponse",
    phone: "Téléphone",
    company: "Entreprise",
    category: "Sujet",
    subject: "Objet de votre demande",
    message: "Comment pouvons-nous vous aider ?",
    send: "Envoyer la demande",
    sending: "Envoi…",
    successTitle: "Votre demande a bien été envoyée.",
    successText:
      "L’équipe LiteHubs l’a reçue et vous répondra à l’adresse indiquée. Un e-mail de confirmation vient de vous être envoyé (pensez à vérifier les courriers indésirables).",
    newRequest: "Envoyer une autre demande",
    privacy:
      "Votre message est transmis uniquement à l’équipe LiteHubs.",
    response: "Traitement suivi",
    responseText:
      "Chaque demande reçoit un statut : nouvelle, en cours ou résolue.",
    secure: "Informations protégées",
    secureText:
      "N’envoyez jamais votre mot de passe, un code de connexion ou une clé privée.",
    emailHint:
      "Utilisez l’adresse à laquelle vous souhaitez recevoir la réponse.",
    messageHint: "Au moins 20 caractères.",
    messageRequired: "Veuillez écrire votre message (au moins 20 caractères).",
    categories: {
      general: "Question générale",
      access: "Accès ou connexion",
      technical: "Problème technique",
      billing: "Facturation",
      demo: "Demander une démonstration",
      privacy: "Confidentialité et suppression de données",
      other: "Autre demande",
    },
  },
  en: {
    eyebrow: "CONTACT LITEHUBS",
    title: "Let’s talk about your operation.",
    description:
      "A question, a demo, an access issue or a request about your data: write to us. Your request goes straight to the LiteHubs team and you receive a confirmation by e-mail.",
    back: "Back to sign in",
    name: "Full name",
    email: "Reply email",
    phone: "Phone",
    company: "Company",
    category: "Topic",
    subject: "Request subject",
    message: "How can we help?",
    send: "Send request",
    sending: "Sending…",
    successTitle: "Your request was sent.",
    successText:
      "The LiteHubs team received it and will reply to the address you provided. A confirmation e-mail has just been sent (check your spam folder).",
    newRequest: "Send another request",
    privacy:
      "Your message is shared only with the LiteHubs team.",
    response: "Tracked handling",
    responseText: "Every request has a status: new, in progress, or resolved.",
    secure: "Protected information",
    secureText: "Never send your password, sign-in code, or a private key.",
    emailHint: "Use the address where you want to receive a reply.",
    messageHint: "At least 20 characters.",
    messageRequired: "Please write your message (at least 20 characters).",
    categories: {
      general: "General question",
      access: "Access or sign in",
      technical: "Technical issue",
      billing: "Billing",
      demo: "Request a demonstration",
      privacy: "Privacy and data deletion",
      other: "Other request",
    },
  },
} as const;

export function ContactPage() {
  const { locale } = useLanguage();
  const text = copy[locale];
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("general");
  const fr = locale === "fr";

  // /contact?sujet=privacy (or demo, access…) opens the form on that topic,
  // also when the header's "Démo" link is clicked while already on this page.
  const wanted = useSearchParams().get("sujet");
  useEffect(() => {
    if (wanted && wanted in copy.fr.categories) setCategory(wanted as Category);
  }, [wanted]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = String(data.get("message") ?? "").trim();
    if (message.length < 20) {
      setFailure(text.messageRequired);
      document.getElementById("contact-message")?.focus();
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      await post("/contact", {
        fullName: String(data.get("fullName") ?? ""),
        email: String(data.get("email") ?? ""),
        phone: String(data.get("phone") ?? ""),
        companyName: String(data.get("companyName") ?? ""),
        category: String(data.get("category") ?? "general"),
        subject: String(data.get("subject") ?? ""),
        message: String(data.get("message") ?? ""),
        preferredLanguage: locale,
      });
      setSubmitted(true);
      // Deliberately send only the non-identifying topic, never form contents.
      trackMarketingEvent("generate_lead", { lead_type: "contact_request", topic: String(data.get("category") ?? "general") });
      event.currentTarget.reset();
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.message
          : locale === "fr"
            ? "Impossible d’envoyer la demande. Réessayez."
            : "We could not send your request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <PublicMarketingAnalytics />
      <SiteHeader />
      <main id="contact-form" className="relative isolate overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute left-[-12rem] top-[-10rem] size-[34rem] rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute right-[-10rem] top-64 size-[28rem] rounded-full bg-chart-3/10 blur-3xl" />
        </div>
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid gap-8 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14 lg:py-16">
          <section className="pt-2 lg:pt-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-bold tracking-[0.13em] text-brand">
              <MessageCircleMore className="size-3.5" aria-hidden />
              {text.eyebrow}
            </p>
            <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-5xl">
              {text.title}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">
              {text.description}
            </p>
            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <button
                type="button"
                onClick={() => {
                  setCategory("demo");
                  document.getElementById("contact-full-name")?.focus();
                }}
                className="block rounded-xl text-left transition hover:-translate-y-0.5"
              >
                <InfoCard
                  icon={CalendarDays}
                  title={fr ? "Demander une démonstration" : "Request a demo"}
                  description={fr ? "Choisissez le sujet « Démonstration » : nous vous proposons un créneau par e-mail." : "Pick the “Demo” topic: we will suggest a time by e-mail."}
                />
              </button>
              <Link href="/forgot-password" className="block rounded-xl transition hover:-translate-y-0.5">
                <InfoCard
                  icon={KeyRound}
                  title={fr ? "Mot de passe oublié ?" : "Forgot your password?"}
                  description={fr ? "Réinitialisez-le vous-même en quelques secondes, sans attendre de réponse." : "Reset it yourself in seconds, no need to wait for a reply."}
                />
              </Link>
              <InfoCard icon={Clock3} title={text.response} description={text.responseText} />
              <InfoCard icon={ShieldCheck} title={text.secure} description={text.secureText} />
            </div>
          </section>

          <section className="self-start overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-[0_24px_70px_-42px_rgba(11,11,11,0.45)]">
            <div className="border-b border-border bg-[linear-gradient(135deg,var(--surface-1),var(--surface-2))] px-5 py-5 sm:px-7">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
                  <Headphones className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-base font-semibold text-ink">
                    {locale === "fr" ? "Envoyer une demande" : "Send a request"}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
                    {text.privacy}
                  </p>
                </div>
              </div>
            </div>

            {submitted ? (
              <div className="px-5 py-12 text-center sm:px-10">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-good/12 text-good">
                  <CheckCircle2 className="size-7" aria-hidden />
                </span>
                <h2 className="mt-5 text-xl font-semibold tracking-[-0.025em]">
                  {text.successTitle}
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-secondary">
                  {text.successText}
                </p>
                <Button
                  className="mt-7"
                  variant="secondary"
                  onClick={() => setSubmitted(false)}
                >
                  {text.newRequest}
                </Button>
              </div>
            ) : (
              <form
                className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7"
                onSubmit={submit}
                noValidate
              >
                <Field label={text.name} htmlFor="contact-full-name" required>
                  <Input
                    id="contact-full-name"
                    name="fullName"
                    autoComplete="name"
                    minLength={2}
                    maxLength={150}
                    required
                  />
                </Field>
                <Field
                  label={text.email}
                  htmlFor="contact-email"
                  required
                  hint={text.emailHint}
                >
                  <Input
                    id="contact-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={255}
                    required
                  />
                </Field>
                <Field label={text.phone} htmlFor="contact-phone">
                  <PhoneInput
                    id="contact-phone"
                    name="phone"
                    maxLength={40}
                    fr={locale === "fr"}
                  />
                </Field>
                <Field label={text.company} htmlFor="contact-company">
                  <Input
                    id="contact-company"
                    name="companyName"
                    autoComplete="organization"
                    maxLength={180}
                  />
                </Field>
                <Field
                  label={text.category}
                  htmlFor="contact-category"
                  required
                >
                  <select
                    id="contact-category"
                    name="category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as Category)}
                    className="h-10 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink shadow-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                  >
                    {(Object.keys(text.categories) as Category[]).map(
                      (category) => (
                        <option key={category} value={category}>
                          {text.categories[category]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label={text.subject} htmlFor="contact-subject" required>
                  <Input
                    id="contact-subject"
                    name="subject"
                    minLength={3}
                    maxLength={180}
                    required
                  />
                </Field>
                <Field
                  className="sm:col-span-2"
                  label={text.message}
                  htmlFor="contact-message"
                  required
                  hint={text.messageHint}
                >
                  <textarea
                    id="contact-message"
                    name="message"
                    minLength={20}
                    maxLength={4000}
                    required
                    rows={7}
                    className="w-full resize-y rounded-md border border-border-strong bg-surface-1 px-3 py-2.5 text-sm leading-6 text-ink shadow-sm outline-none transition placeholder:text-ink-muted focus:border-brand focus:ring-4 focus:ring-brand/10"
                  />
                </Field>
                {failure ? (
                  <p
                    className="sm:col-span-2 rounded-lg border border-critical/35 bg-critical/10 px-3 py-2.5 text-sm text-critical"
                    role="alert"
                  >
                    {failure}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 sm:col-span-2">
                  <p className="flex max-w-md items-start gap-2 text-xs leading-5 text-ink-muted">
                    <Mail
                      className="mt-0.5 size-3.5 shrink-0 text-brand"
                      aria-hidden
                    />
                    {text.privacy}
                  </p>
                  <Button
                    type="submit"
                    loading={submitting}
                    className="min-w-42"
                  >
                    {submitting ? text.sending : text.send}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Clock3;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface-1 p-4 shadow-[0_10px_26px_-24px_rgba(11,11,11,0.55)]">
      <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">{description}</p>
    </article>
  );
}
