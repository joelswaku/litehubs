"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { resetPassword } from "@/lib/auth";
import { useLanguage } from "@/providers/language-provider";
type Values = { password: string; confirmPassword: string };
export function ResetPasswordForm() {
  const { t } = useLanguage();
  const token = useSearchParams().get("token");
  const schema = useMemo(
    () =>
      z
        .object({
          password: z
            .string()
            .min(10, t("validation.passwordLength"))
            .regex(/[a-z]/, t("validation.passwordLowercase"))
            .regex(/[A-Z]/, t("validation.passwordUppercase"))
            .regex(/[0-9]/, t("validation.passwordNumber")),
          confirmPassword: z.string(),
        })
        .refine((value) => value.password === value.confirmPassword, {
          path: ["confirmPassword"],
          message: t("validation.passwordMatch"),
        }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const reset = useMutation({
    mutationFn: (values: Values) => resetPassword(token ?? "", values.password),
  });
  if (!token)
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {t("reset.incomplete")}
        </p>
        <Link
          className="text-sm font-medium text-brand underline-offset-4 hover:underline"
          href="/forgot-password"
        >
          {t("reset.request")}
        </Link>
      </div>
    );
  if (reset.isSuccess)
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-good/30 bg-good/10 px-3 py-2 text-sm text-ink-secondary">
          {t("reset.success")}
        </p>
        <Link
          className="text-sm font-medium text-brand underline-offset-4 hover:underline"
          href="/login"
        >
          {t("register.signIn")}
        </Link>
      </div>
    );
  const message =
    reset.error instanceof ApiError
      ? reset.error.message
      : reset.error
        ? t("reset.failed")
        : null;
  return (
    <form
      onSubmit={form.handleSubmit((values) => reset.mutate(values))}
      className="space-y-4"
      noValidate
    >
      {message ? (
        <p
          className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <Field
        label={t("reset.newPassword")}
        htmlFor="password"
        required
        hint={t("register.passwordHint")}
        error={form.formState.errors.password?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
      </Field>
      <Field
        label={t("reset.confirmPassword")}
        htmlFor="confirmPassword"
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
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={reset.isPending}
      >
        {t("reset.update")}
      </Button>
    </form>
  );
}
