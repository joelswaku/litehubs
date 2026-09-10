"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Headphones,
  Mail,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, post } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Category =
  "general" | "access" | "technical" | "billing" | "demo" | "other";

const copy = {
  fr: {
    eyebrow: "ASSISTANCE LITEHUBS",
    title: "Parlez à l’administrateur LiteHubs.",
    description:
      "Expliquez ce dont vous avez besoin. Votre demande est enregistrée dans le centre d’assistance sécurisé afin qu’un administrateur puisse la traiter.",
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
      "Un administrateur LiteHubs la verra dans le centre d’assistance et vous répondra à l’adresse indiquée.",
    newRequest: "Envoyer une autre demande",
    privacy:
      "Votre message est transmis uniquement aux administrateurs LiteHubs autorisés.",
    response: "Traitement suivi",
    responseText:
      "Chaque demande reçoit un statut : nouvelle, en cours ou résolue.",
    secure: "Informations protégées",
    secureText:
      "N’envoyez jamais votre mot de passe, un code de connexion ou une clé privée.",
    emailHint:
      "Utilisez l’adresse à laquelle vous souhaitez recevoir la réponse.",
    messageHint: "Au moins 20 caractères.",
    categories: {
      general: "Question générale",
      access: "Accès ou connexion",
      technical: "Problème technique",
      billing: "Facturation",
      demo: "Demander une démonstration",
      other: "Autre demande",
    },
  },
  en: {
    eyebrow: "LITEHUBS SUPPORT",
    title: "Contact a LiteHubs administrator.",
    description:
      "Tell us what you need. Your request is saved in the secure support centre so an administrator can handle it.",
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
      "A LiteHubs administrator will see it in the support centre and respond to the email address you provided.",
    newRequest: "Send another request",
    privacy:
      "Your message is shared only with authorized LiteHubs administrators.",
    response: "Tracked handling",
    responseText: "Every request has a status: new, in progress, or resolved.",
    secure: "Protected information",
    secureText: "Never send your password, sign-in code, or a private key.",
    emailHint: "Use the address where you want to receive a reply.",
    messageHint: "At least 20 characters.",
    categories: {
      general: "General question",
      access: "Access or sign in",
      technical: "Technical issue",
      billing: "Billing",
      demo: "Request a demonstration",
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
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
    <main className="min-h-dvh bg-page text-ink">
      <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8 sm:py-7 lg:px-10">
        <nav
          className="flex items-center justify-between"
          aria-label="LiteHubs"
        >
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <BrandMark size={32} className="rounded-lg shadow-sm" />
            <span className="text-lg font-semibold tracking-[-0.04em]">
              LiteHubs
            </span>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-secondary transition hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {text.back}
          </Link>
        </nav>

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
              <InfoCard
                icon={Clock3}
                title={text.response}
                description={text.responseText}
              />
              <InfoCard
                icon={ShieldCheck}
                title={text.secure}
                description={text.secureText}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-[0_24px_70px_-42px_rgba(11,11,11,0.45)]">
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
                  <Input
                    id="contact-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength={40}
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
                    defaultValue="general"
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
