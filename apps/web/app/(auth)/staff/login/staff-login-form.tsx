"use client";
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, post, setActiveOrganizationSlug } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { sessionKey } from "@/hooks/useAuth";
import { useLanguage } from "@/providers/language-provider";
import { useSessionStore } from "@/stores/session-store";
type Values = { email: string; password: string };
export function StaffLoginForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useSessionStore((state) => state.setUser);
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().trim().email(t("validation.email")),
        password: z.string().min(1, t("validation.passwordRequired")),
      }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const login = useMutation({
    mutationFn: (values: Values) =>
      post<{ user: SessionUser }>("/auth/staff-login", values),
    onSuccess: (result) => {
      setActiveOrganizationSlug(null);
      setUser(result.user);
      queryClient.setQueryData(sessionKey, result.user);
      router.replace("/platform");
    },
  });
  const message =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? t("login.failed")
        : null;
  return (
    <form
      onSubmit={form.handleSubmit((values) => login.mutate(values))}
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
      <div className="rounded-md border border-brand/20 bg-brand-subtle px-3 py-2 text-xs text-ink-secondary">
        <ShieldCheck className="mr-1 inline size-3.5 text-brand" aria-hidden />
        {t("staff.notice")}
      </div>
      <Field
        label={t("staff.email")}
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
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-ink-secondary">
            {t("login.password")}{" "}
            <span className="text-critical" aria-hidden>
              *
            </span>
          </span>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-brand underline-offset-4 hover:underline"
          >
            {t("login.forgotPassword")}
          </Link>
        </div>
        <Input
          type="password"
          autoComplete="current-password"
          invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
        {form.formState.errors.password?.message ? (
          <p className="text-xs text-critical" aria-live="polite">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={login.isPending}
      >
        {login.isPending ? t("login.submitting") : t("staff.submit")}
      </Button>
    </form>
  );
}
