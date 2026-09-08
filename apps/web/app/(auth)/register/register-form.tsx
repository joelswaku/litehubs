"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, setActiveOrganizationSlug } from "@/lib/api";
import { register as registerCompany } from "@/lib/auth";
import { sessionKey } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
import { useSessionStore } from "@/stores/session-store";

type Values = {
  fullName: string;
  email: string;
  password: string;
  legalName: string;
  slug: string;
  industryCode:
    "agriculture" | "poultry" | "livestock" | "mixed_farm" | "other";
  country: string;
  currency: string;
};
const authInputClass =
  "h-11 rounded-lg border-border bg-page px-3.5 shadow-sm transition-shadow focus-visible:outline-brand focus-visible:ring-4 focus-visible:ring-brand/10";
const selectClass =
  "h-11 w-full rounded-lg border border-border bg-page px-3.5 text-sm text-ink shadow-sm outline-none transition-shadow focus-visible:outline-2 focus-visible:outline-brand focus-visible:ring-4 focus-visible:ring-brand/10";

export function RegisterForm() {
  const { t } = useLanguage();
  const schema = useMemo(
    () =>
      z.object({
        fullName: z.string().trim().min(2, t("validation.fullName")).max(150),
        email: z.string().trim().email(t("validation.email")),
        password: z
          .string()
          .min(10, t("validation.passwordLength"))
          .regex(/[a-z]/, t("validation.passwordLowercase"))
          .regex(/[A-Z]/, t("validation.passwordUppercase"))
          .regex(/[0-9]/, t("validation.passwordNumber")),
        legalName: z
          .string()
          .trim()
          .min(2, t("validation.companyName"))
          .max(200),
        slug: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, t("validation.slug")),
        industryCode: z.enum([
          "agriculture",
          "poultry",
          "livestock",
          "mixed_farm",
          "other",
        ]),
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, t("validation.country")),
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3}$/, t("validation.currency")),
      }),
    [t],
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      industryCode: "mixed_farm",
      country: "CD",
      currency: "CDF",
    },
  });
  const create = useMutation({
    mutationFn: (values: Values) =>
      registerCompany({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        organization: {
          slug: values.slug,
          legalName: values.legalName,
          displayName: values.legalName,
          industryCode: values.industryCode,
          country: values.country,
          currency: values.currency,
        },
      }),
    onSuccess: (result) => {
      setUser(result.user);
      queryClient.setQueryData(sessionKey, result.user);
      setActiveOrganizationSlug(result.organization.slug);
      router.replace(`/${result.organization.slug}/dashboard`);
    },
  });
  const message =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? t("register.failed")
        : null;

  return (
    <form
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
      className="space-y-6 rounded-2xl border border-border bg-surface-1 p-5 shadow-[0_18px_50px_-28px_rgba(11,11,11,0.28)] sm:p-6"
      noValidate
    >
      {message ? (
        <p
          className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2.5 text-sm text-critical"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">
            {t("register.ownerAccount")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {t("register.ownerAccountDescription")}
          </p>
        </div>
        <Field
          label={t("register.fullName")}
          htmlFor="fullName"
          required
          error={form.formState.errors.fullName?.message}
        >
          <Input
            autoComplete="name"
            className={authInputClass}
            invalid={Boolean(form.formState.errors.fullName)}
            {...form.register("fullName")}
          />
        </Field>
        <Field
          label={t("register.workEmail")}
          htmlFor="email"
          required
          error={form.formState.errors.email?.message}
        >
          <Input
            type="email"
            autoComplete="email"
            className={authInputClass}
            invalid={Boolean(form.formState.errors.email)}
            {...form.register("email")}
          />
        </Field>
        <Field
          label={t("register.password")}
          htmlFor="password"
          required
          hint={t("register.passwordHint")}
          error={form.formState.errors.password?.message}
        >
          <Input
            type="password"
            autoComplete="new-password"
            className={authInputClass}
            invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
        </Field>
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-surface-2/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
            <Building2 className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {t("register.company")}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">
              {t("register.companyDescription")}
            </p>
          </div>
        </div>
        <Field
          label={t("register.companyName")}
          htmlFor="legalName"
          required
          error={form.formState.errors.legalName?.message}
        >
          <Input
            className={authInputClass}
            invalid={Boolean(form.formState.errors.legalName)}
            {...form.register("legalName")}
          />
        </Field>
        <Field
          label={t("register.workspaceAddress")}
          htmlFor="slug"
          required
          hint={t("register.workspaceHint")}
          error={form.formState.errors.slug?.message}
        >
          <Input
            autoCapitalize="none"
            placeholder="congo-omega"
            className={authInputClass}
            invalid={Boolean(form.formState.errors.slug)}
            {...form.register("slug")}
          />
        </Field>
        <Field
          label={t("register.mainActivity")}
          htmlFor="industryCode"
          required
          error={form.formState.errors.industryCode?.message}
        >
          <select
            id="industryCode"
            className={selectClass}
            {...form.register("industryCode")}
          >
            <option value="mixed_farm">{t("register.industryMixed")}</option>
            <option value="poultry">{t("register.industryPoultry")}</option>
            <option value="livestock">{t("register.industryLivestock")}</option>
            <option value="agriculture">
              {t("register.industryAgriculture")}
            </option>
            <option value="other">{t("register.industryOther")}</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("register.country")}
            htmlFor="country"
            required
            error={form.formState.errors.country?.message}
          >
            <Input
              placeholder="CD"
              className={authInputClass}
              invalid={Boolean(form.formState.errors.country)}
              {...form.register("country")}
            />
          </Field>
          <Field
            label={t("register.currency")}
            htmlFor="currency"
            required
            error={form.formState.errors.currency?.message}
          >
            <Input
              placeholder="CDF"
              className={authInputClass}
              invalid={Boolean(form.formState.errors.currency)}
              {...form.register("currency")}
            />
          </Field>
        </div>
      </div>
      <div className="space-y-3">
        <Button
          type="submit"
          size="lg"
          className="h-11 w-full rounded-lg font-semibold shadow-sm"
          loading={create.isPending}
        >
          {create.isPending ? t("register.creating") : t("register.create")}
        </Button>
        <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-5 text-ink-muted">
          <ShieldCheck
            className="mt-0.5 size-3.5 shrink-0 text-brand"
            aria-hidden
          />
          {t("register.private")}
        </p>
      </div>
    </form>
  );
}
