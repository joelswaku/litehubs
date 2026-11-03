"use client";

import { Mail, MessageSquareText, Send } from "lucide-react";

export type NotifyChannel = "email" | "sms" | "both";

/** Default: e-mail when the candidate has one, otherwise SMS. */
export function defaultNotifyChannel(contact: { email?: string | null; phone?: string | null }): NotifyChannel {
  return contact.email ? "email" : "sms";
}

/** E-mail, SMS or both, for anything sent to a candidate. A channel the
 * candidate has no address for is shown but disabled. */
export function NotifyChannelPicker({
  value,
  onChange,
  hasEmail,
  hasPhone,
  fr,
  className = "",
}: {
  value: NotifyChannel;
  onChange: (value: NotifyChannel) => void;
  hasEmail: boolean;
  hasPhone: boolean;
  fr: boolean;
  className?: string;
}) {
  const options: { value: NotifyChannel; label: string; icon: typeof Mail; enabled: boolean }[] = [
    { value: "email", label: "E-mail", icon: Mail, enabled: hasEmail },
    { value: "sms", label: "SMS", icon: MessageSquareText, enabled: hasPhone },
    { value: "both", label: fr ? "Les deux" : "Both", icon: Send, enabled: hasEmail && hasPhone },
  ];
  return (
    <div role="radiogroup" aria-label={fr ? "Envoyer par" : "Send by"} className={`grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1 ${className}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!option.enabled}
            title={option.enabled ? undefined : fr ? "Coordonnée manquante" : "Missing contact"}
            onClick={() => onChange(option.value)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-surface-1 text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
            }`}
          >
            <Icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
