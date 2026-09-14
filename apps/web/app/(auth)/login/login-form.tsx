"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useLogin } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type FormValues = { email: string; password: string };
const authInputClass =
  "h-11 rounded-lg border-border bg-page px-3.5 shadow-sm transition-shadow focus-visible:outline-brand focus-visible:ring-4 focus-visible:ring-brand/10";

export function LoginForm() {
  const { t } = useLanguage();
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t("validation.emailRequired"))
          .email(t("validation.email")),
        password: z.string().min(1, t("validation.passwordRequired")),
      }),
    [t],
  );
  const searchParams = useSearchParams();
  const login = useLogin(searchParams.get("next"));
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const failureMessage = (() => {
    const error = login.error;
    if (!error) return null;
    if (error instanceof ApiError) {
      if (error.status === 423 || error.status === 0) return error.message;
      if (error.status === 401) return t("login.invalidCredentials");
      // A reverse proxy may return an HTML 500 page. Never expose its raw
      // transport message (for example, "Request failed with status code 500")
      // as if it were useful guidance to an employee.
      if (error.status >= 500) return t("login.failed");
      return error.message;
    }
    return t("login.failed");
  })();

  return (
    <form
      onSubmit={handleSubmit((values) => login.mutate(values))}
      className="space-y-5 rounded-2xl border border-border bg-surface-1 p-5 shadow-[0_18px_50px_-28px_rgba(11,11,11,0.28)] sm:p-6"
      noValidate
    >
      {failureMessage ? (
        <div
          className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2.5 text-sm text-critical"
          role="alert"
        >
          {failureMessage}
        </div>
      ) : null}
      <Field
        label={t("login.email")}
        htmlFor="email"
        required
        error={errors.email?.message}
      >
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="vous@entreprise.com"
          className={authInputClass}
          invalid={Boolean(errors.email)}
          {...register("email")}
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
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className={`${authInputClass} pr-11`}
            invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-muted transition-colors hover:text-ink"
            tabIndex={-1}
            aria-label={
              showPassword
                ? "Masquer le mot de passe"
                : "Afficher le mot de passe"
            }
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        {errors.password ? (
          <p
            id="password-error"
            className="text-xs text-critical"
            aria-live="polite"
          >
            {errors.password.message}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        className="h-11 w-full rounded-lg font-semibold shadow-sm"
        loading={login.isPending}
        size="lg"
      >
        {login.isPending ? t("login.submitting") : t("login.submit")}
      </Button>
      <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-5 text-ink-muted">
        <ShieldCheck
          className="mt-0.5 size-3.5 shrink-0 text-brand"
          aria-hidden
        />
        {t("login.protected")}
      </p>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
    </form>
  );
}
