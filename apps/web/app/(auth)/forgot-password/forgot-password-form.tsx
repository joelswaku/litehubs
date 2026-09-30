"use client";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  requestPasswordReset,
  type PasswordResetDeliveryMethod,
} from "@/lib/auth";
import { useLanguage } from "@/providers/language-provider";

type Values = {
  identifier: string;
  deliveryMethod: PasswordResetDeliveryMethod;
};

export function ForgotPasswordForm() {
  const { t } = useLanguage();
  const [sent, setSent] = useState(false);
  const [deliveryMethod, setDeliveryMethod] =
    useState<PasswordResetDeliveryMethod>("email");
  const schema = useMemo(
    () =>
      z.object({
        identifier:
          deliveryMethod === "email"
            ? z.string().trim().email(t("validation.email"))
            : z.string().trim().min(8, t("validation.phone")),
        deliveryMethod: z.enum(["email", "sms"]),
      }),
    [deliveryMethod, t],
  );
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", deliveryMethod: "email" },
  });
  const request = useMutation({
    mutationFn: (values: Values) =>
      requestPasswordReset(values.identifier, values.deliveryMethod),
    onSuccess: () => setSent(true),
  });

  function chooseDeliveryMethod(next: PasswordResetDeliveryMethod) {
    setDeliveryMethod(next);
    form.setValue("deliveryMethod", next);
    // An e-mail is not a valid phone number and vice versa. Starting this
    // field clean avoids accidentally sending the wrong kind of identifier.
    form.resetField("identifier");
  }

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
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">
          {t("forgot.delivery")}
        </legend>
        <div className="grid grid-cols-2 gap-2" role="group">
          {(["email", "sms"] as const).map((method) => {
            const selected = deliveryMethod === method;
            return (
              <button
                key={method}
                type="button"
                aria-pressed={selected}
                onClick={() => chooseDeliveryMethod(method)}
                className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                  selected
                    ? "border-brand bg-brand text-brand-ink"
                    : "border-border bg-surface-2 text-ink hover:bg-surface-3"
                }`}
              >
                {method === "email" ? t("forgot.email") : t("forgot.sms")}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field
        label={
          deliveryMethod === "email" ? t("forgot.email") : t("forgot.phone")
        }
        htmlFor="identifier"
        required
        error={form.formState.errors.identifier?.message}
      >
        <Input
          type={deliveryMethod === "email" ? "email" : "tel"}
          autoComplete={deliveryMethod === "email" ? "email" : "tel"}
          autoFocus
          placeholder={
            deliveryMethod === "email" ? "nom@entreprise.com" : "+243 8…"
          }
          inputMode={deliveryMethod === "email" ? "email" : "tel"}
          invalid={Boolean(form.formState.errors.identifier)}
          {...form.register("identifier")}
        />
      </Field>
      {deliveryMethod === "sms" ? (
        <p className="text-xs leading-5 text-ink-secondary">
          {t("forgot.phoneHint")}
        </p>
      ) : null}
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
