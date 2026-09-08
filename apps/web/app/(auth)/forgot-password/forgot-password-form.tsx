"use client";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth";
import { useLanguage } from "@/providers/language-provider";
type Values = { email: string };
export function ForgotPasswordForm() {
  const { t } = useLanguage();
  const [sent, setSent] = useState(false);
  const schema = useMemo(
    () => z.object({ email: z.string().trim().email(t("validation.email")) }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const request = useMutation({
    mutationFn: (values: Values) => requestPasswordReset(values.email),
    onSuccess: () => setSent(true),
  });
  if (sent)
    return (
      <div
        className="rounded-lg border border-good/30 bg-good/10 p-4 text-sm text-ink-secondary"
        role="status"
      >
        {t("forgot.sent")}
      </div>
    );
  return (
    <form
      onSubmit={form.handleSubmit((values) => request.mutate(values))}
      className="space-y-4"
      noValidate
    >
      <Field
        label={t("forgot.email")}
        htmlFor="email"
        required
        error={form.formState.errors.email?.message}
      >
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          invalid={Boolean(form.formState.errors.email)}
          {...form.register("email")}
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={request.isPending}
      >
        {t("forgot.submit")}
      </Button>
    </form>
  );
}
