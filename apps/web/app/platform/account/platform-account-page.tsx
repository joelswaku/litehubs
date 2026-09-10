"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { changePassword } from "@/lib/auth";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Values = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

/**
 * The platform plane deliberately has its own account page. It calls the same
 * authenticated endpoint as every other account, but never sends a staff
 * member into a customer's workspace just to change their own password.
 */
export function PlatformAccountPage() {
  const { t } = useLanguage();
  const user = useSessionUser();
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, t("validation.passwordRequired")),
          newPassword: z
            .string()
            .min(10, t("validation.passwordLength"))
            .regex(/[a-z]/, t("validation.passwordLowercase"))
            .regex(/[A-Z]/, t("validation.passwordUppercase"))
            .regex(/[0-9]/, t("validation.passwordNumber")),
          confirmPassword: z.string(),
        })
        .refine((values) => values.currentPassword !== values.newPassword, {
          path: ["newPassword"],
          message: t("platform.accountPasswordDifferent"),
        })
        .refine((values) => values.newPassword === values.confirmPassword, {
          path: ["confirmPassword"],
          message: t("validation.passwordMatch"),
        }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const updatePassword = useMutation({
    mutationFn: (values: Values) =>
      changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      form.reset();
      // The API clears the cookies and revokes every refresh token. A full
      // navigation therefore both reflects the signed-out state and avoids a
      // platform cache remaining visible behind the sign-in page.
      window.setTimeout(
        () => window.location.assign("/staff?passwordChanged=1"),
        500,
      );
    },
  });
  const error =
    updatePassword.error instanceof ApiError
      ? updatePassword.error.message
      : updatePassword.error
        ? t("platform.accountPasswordFailed")
        : null;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8">
      <Link
        href="/platform"
        className="inline-flex items-center gap-2 text-sm font-medium text-ink-secondary transition hover:text-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("platform.accountBack")}
      </Link>

      <section className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(125deg,#0d366b_0%,#184f95_48%,#2a78d6_100%)] px-5 py-7 text-white shadow-[0_20px_55px_-28px_rgba(13,54,107,0.75)] sm:px-7 sm:py-8">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full border border-white/10 bg-white/5"
          aria-hidden
        />
        <div className="relative flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white">
            <KeyRound className="size-5" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100">
              {t("platform.kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
              {t("platform.accountTitle")}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-50/85">
              {t("platform.accountDescription")}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        <div className="border-b border-border bg-surface-2/60 px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-ink">
            {user?.fullName ?? "—"}
          </p>
          <p className="mt-0.5 text-sm text-ink-secondary">
            {user?.email ?? ""}
          </p>
        </div>
        <form
          className="space-y-5 p-5 sm:p-6"
          onSubmit={form.handleSubmit((values) =>
            updatePassword.mutate(values),
          )}
          noValidate
        >
          <div className="rounded-lg border border-brand/20 bg-brand-subtle/70 px-3.5 py-3 text-sm leading-6 text-ink-secondary">
            <ShieldCheck
              className="mr-1.5 inline size-4 text-brand"
              aria-hidden
            />
            {t("platform.accountPasswordHint")}
          </div>
          {error ? (
            <p
              className="rounded-lg border border-critical/40 bg-critical/10 px-3.5 py-3 text-sm text-critical"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <Field
            label={t("platform.accountCurrentPassword")}
            htmlFor="current-password"
            required
            error={form.formState.errors.currentPassword?.message}
          >
            <Input
              type="password"
              autoComplete="current-password"
              invalid={Boolean(form.formState.errors.currentPassword)}
              {...form.register("currentPassword")}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t("platform.accountNewPassword")}
              htmlFor="new-password"
              required
              hint={t("register.passwordHint")}
              error={form.formState.errors.newPassword?.message}
            >
              <Input
                type="password"
                autoComplete="new-password"
                invalid={Boolean(form.formState.errors.newPassword)}
                {...form.register("newPassword")}
              />
            </Field>
            <Field
              label={t("platform.accountConfirmPassword")}
              htmlFor="confirm-password"
              required
              error={form.formState.errors.confirmPassword?.message}
            >
              <Input
                type="password"
                autoComplete="new-password"
                invalid={Boolean(form.formState.errors.confirmPassword)}
                {...form.register("confirmPassword")}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button type="submit" size="lg" loading={updatePassword.isPending}>
              {t("platform.accountSavePassword")}
            </Button>
            <p className="text-xs leading-5 text-ink-muted">
              {t("platform.accountSignOutNotice")}
            </p>
          </div>
        </form>
      </section>
    </main>
  );
}
