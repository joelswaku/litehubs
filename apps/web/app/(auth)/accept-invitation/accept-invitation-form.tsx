"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, post, setActiveOrganizationSlug } from "@/lib/api";
import type { RegisterResult } from "@/lib/auth";
import { sessionKey } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
import { useSessionStore } from "@/stores/session-store";
type Values = { fullName: string; email: string; password: string };
export function AcceptInvitationForm() {
  const { t } = useLanguage();
  const token = useSearchParams().get("token");
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
