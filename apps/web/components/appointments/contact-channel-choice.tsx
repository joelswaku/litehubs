"use client";

import { Mail, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export type ContactChannel = "email" | "sms";

/**
 * "Receive my messages by: e-mail / SMS". The visitor gets each update on one
 * channel only; the other is used automatically if the first one fails.
 */
export function ContactChannelChoice({
  value,
  onChange,
  fr,
  hasEmail,
  hasPhone,
  className,
}: {
  value: ContactChannel;
  onChange: (value: ContactChannel) => void;
  fr: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  className?: string;
}) {
  const options: { id: ContactChannel; icon: typeof Mail; fr: string; en: string; available: boolean }[] = [
    { id: "email", icon: Mail, fr: "E-mail", en: "E-mail", available: hasEmail },
    { id: "sms", icon: Smartphone, fr: "SMS", en: "SMS", available: hasPhone },
  ];
  const effective = options.find((option) => option.id === value)?.available
    ? value
    : options.find((option) => option.available)?.id ?? value;
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-sm font-medium text-ink">
        {fr ? "Recevoir les messages par" : "Receive messages by"}
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {options.map((option) => {
          const Icon = option.icon;
          const active = effective === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!option.available}
              onClick={() => onChange(option.id)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition",
                active
                  ? "border-brand bg-brand text-brand-ink shadow-sm"
                  : "border-border bg-surface-1 text-ink hover:border-brand/40",
                !option.available && "cursor-not-allowed opacity-45",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {fr ? option.fr : option.en}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">
        {fr
          ? "Un seul message par mise à jour, sur le canal choisi. L’autre n’est utilisé que si le premier échoue."
          : "One message per update, on the chosen channel. The other is used only if the first one fails."}
      </p>
    </div>
  );
}

/** The channel actually sent to the API, given what the visitor filled in. */
export function resolvedChannel(value: ContactChannel, email: string, phone: string): ContactChannel | null {
  if (value === "sms" && phone.trim()) return "sms";
  if (value === "email" && email.trim()) return "email";
  if (email.trim()) return "email";
  if (phone.trim()) return "sms";
  return null;
}
