"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { CircleAlert, Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, post, setActiveOrganizationSlug } from "@/lib/api";
import type { RegisterResult } from "@/lib/auth";
import { sessionKey } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
import { useSessionStore } from "@/stores/session-store";
type Values = { fullName: string; email: string; password: string };
type LinkStatus = {
  status: "valid" | "used" | "revoked" | "expired" | "invalid";
  organizationName: string | null;
  emailHint: string | null;
  existingAccount: boolean;
};
export function AcceptInvitationForm() {
  const { t, locale } = useLanguage();
  const fr = locale === "fr";
  const token = useSearchParams().get("token");
  // Check the link first: a used, revoked or expired link must say so instead
  // of showing a password form that can only fail.
  const linkStatus = useQuery({
    queryKey: ["invitation-status", token],
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
    queryFn: () => post<LinkStatus>("/auth/invitation-status", { token: token ?? "" }),
  });
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);
  const existingAccount = useSessionStore((state) => state.user);
  const [showPassword, setShowPassword] = useState(false);
  const schema = useMemo(
    () =>
      z.object({
        fullName: z.string().trim().min(2, t("validation.name")),
        email: z.string().trim().email(t("validation.email")),
        password: z
          .string()
          .min(10, t("validation.passwordLength"))
          .regex(/[a-z]/, t("validation.passwordLowercase"))
          .regex(/[A-Z]/, t("validation.passwordUppercase"))
          .regex(/[0-9]/, t("validation.passwordNumber")),
      }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const accept = useMutation({
    mutationFn: (values: Values) =>
      post<RegisterResult>("/auth/accept-invitation", {
        ...values,
        token: token ?? "",
      }),
    onSuccess: (result) => {
      setUser(result.user);
      queryClient.setQueryData(sessionKey, result.user);
      setActiveOrganizationSlug(result.organization.slug);
      router.replace(`/${result.organization.slug}/dashboard`);
    },
  });
  const acceptExisting = useMutation({
    mutationFn: () => post<RegisterResult>("/auth/accept-existing-invitation", { token: token ?? "" }),
    onSuccess: (result) => {
      setUser(result.user);
      queryClient.setQueryData(sessionKey, result.user);
      setActiveOrganizationSlug(result.organization.slug);
      router.replace(`/${result.organization.slug}/dashboard`);
    },
  });
  const loginReturnUrl = `/login?next=${encodeURIComponent(`/accept-invitation?token=${token ?? ""}`)}`;
  if (!token)
    return (
      <p className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
        {t("invite.incomplete")}
      </p>
    );
  if (linkStatus.isLoading)
    return (
      <div className="space-y-3" aria-busy>
        <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  const status = linkStatus.data?.status;
  if (status && status !== "valid") {
    const copy: Record<Exclude<LinkStatus["status"], "valid">, [string, string, string, string]> = {
      used: [
        "Ce lien a déjà été utilisé",
        "This link has already been used",
        "Votre accès est déjà activé et votre mot de passe est déjà créé. Connectez-vous avec votre e-mail et votre mot de passe. Si vous l’avez oublié, utilisez « Mot de passe oublié ».",
        "Your access is already active and your password is already set. Sign in with your e-mail and password. If you forgot it, use “Forgot password”.",
      ],
      expired: [
        "Ce lien a expiré",
        "This link has expired",
        "Pour des raisons de sécurité, le lien n’est valable que 7 jours. Demandez à votre responsable de vous renvoyer un nouvel accès.",
        "For security the link is only valid for 7 days. Ask your manager to send you a new access link.",
      ],
      revoked: [
        "Ce lien n’est plus valable",
        "This link is no longer valid",
        "L’accès lié à ce lien a été annulé ou remplacé par un lien plus récent. Utilisez le dernier e-mail reçu ou contactez votre responsable.",
        "The access for this link was cancelled or replaced by a newer link. Use the latest e-mail you received or contact your manager.",
      ],
      invalid: [
        "Lien invalide",
        "Invalid link",
        "Ce lien est incomplet ou incorrect. Ouvrez le bouton directement depuis l’e-mail reçu, ou demandez un nouvel accès.",
        "This link is incomplete or incorrect. Open the button directly from the e-mail, or ask for a new access link.",
      ],
    };
    const [titleFr, titleEn, bodyFr, bodyEn] = copy[status];
    const used = status === "used";
    return (
      <section
        className={`space-y-4 rounded-2xl border p-5 ${used ? "border-brand/25 bg-brand/[.05]" : "border-warning/40 bg-warning/10"}`}
        role="status"
      >
        <div className="flex items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${used ? "bg-brand/15 text-brand" : "bg-warning/20 text-warning"}`}>
            {used ? <ShieldCheck className="size-5" aria-hidden /> : <CircleAlert className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{fr ? titleFr : titleEn}</p>
            {linkStatus.data?.organizationName ? (
              <p className="mt-0.5 text-xs text-ink-muted">
                {linkStatus.data.organizationName}
                {linkStatus.data.emailHint ? ` · ${linkStatus.data.emailHint}` : ""}
              </p>
            ) : null}
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{fr ? bodyFr : bodyEn}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/login"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover"
          >
            <LogIn className="size-4" aria-hidden />
            {fr ? "Se connecter" : "Sign in"}
          </Link>
          {used ? (
            <Link
              href="/forgot-password"
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border bg-surface-1 px-4 text-sm font-semibold text-ink transition hover:bg-surface-2"
            >
              {fr ? "Mot de passe oublié" : "Forgot password"}
            </Link>
          ) : null}
        </div>
      </section>
    );
  }
  const message =
    accept.error instanceof ApiError
      ? accept.error.message
      : accept.error
        ? t("invite.failed")
        : null;
  if (existingAccount) {
    const existingMessage = acceptExisting.error instanceof ApiError
      ? acceptExisting.error.message
      : acceptExisting.error ? t("invite.failed") : null;
    return <section className="space-y-5 rounded-2xl border border-brand/20 bg-[linear-gradient(135deg,rgba(20,184,166,.10),transparent_58%),var(--surface-1)] p-5 shadow-sm">
      <div><p className="text-sm font-semibold text-ink">Utiliser votre compte LiteHubs existant</p><p className="mt-2 text-sm leading-6 text-ink-secondary">Vous êtes connecté avec <b className="font-semibold text-ink">{existingAccount.email}</b>. Cette invitation sera activée uniquement si elle a été envoyée à cette même adresse.</p></div>
      {existingMessage ? <p className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical" role="alert">{existingMessage}</p> : null}
      <Button type="button" size="lg" className="w-full" loading={acceptExisting.isPending} onClick={() => acceptExisting.mutate()}>Activer l’accès avec ce compte</Button>
      <Link href={loginReturnUrl} className="block text-center text-xs font-semibold text-brand underline-offset-4 hover:underline">Se connecter avec un autre compte</Link>
    </section>;
  }
  return (
    <form
      onSubmit={form.handleSubmit((values) => accept.mutate(values))}
      className="space-y-4"
      noValidate
    >
      {message ? (
        <div className="space-y-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical" role="alert">
          <p>{message}</p>
          {accept.error instanceof ApiError && accept.error.status === 409 ? <Link href={loginReturnUrl} className="font-semibold underline underline-offset-4">Se connecter avec le compte existant</Link> : null}
        </div>
      ) : null}
      <Field
        label={t("invite.fullName")}
        htmlFor="fullName"
        required
        error={form.formState.errors.fullName?.message}
      >
        <Input
          autoComplete="name"
          invalid={Boolean(form.formState.errors.fullName)}
          {...form.register("fullName")}
        />
      </Field>
      <Field
        label={t("invite.email")}
        htmlFor="email"
        required
        error={form.formState.errors.email?.message}
      >
        <Input
          type="email"
          autoComplete="email"
          invalid={Boolean(form.formState.errors.email)}
          {...form.register("email")}
        />
      </Field>
      <Field
        label={t("invite.password")}
        htmlFor="password"
        required
        hint={t("register.passwordHint")}
        error={form.formState.errors.password?.message}
      >
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="pr-11"
            invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={accept.isPending}
      >
        {t("invite.join")}
      </Button>
    </form>
  );
}
