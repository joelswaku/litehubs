"use client";

import * as React from "react";
import { phoneErrorMessage, validatePhone } from "@/lib/phone";
import { Input, type InputProps } from "@/components/ui/input";

type PhoneInputProps = Omit<InputProps, "type" | "inputMode"> & {
  /** Used by controlled forms to retain the canonical number after blur. */
  onNormalizedChange?: (value: string) => void;
  fr?: boolean;
};

/** A telephone input that accepts local RDC notation and stores E.164. */
export function PhoneInput({
  onBlur,
  onNormalizedChange,
  fr = true,
  placeholder = "+243 898 869 772",
  ...props
}: PhoneInputProps) {
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Input
        {...props}
        type="tel"
        inputMode="tel"
        autoComplete={props.autoComplete ?? "tel"}
        placeholder={placeholder}
        invalid={Boolean(error) || props.invalid}
        onBlur={(event) => {
          const result = validatePhone(event.currentTarget.value);
          const message = phoneErrorMessage(result.error, fr);
          event.currentTarget.setCustomValidity(message ?? "");
          setError(message);

          if (result.normalized && result.normalized !== event.currentTarget.value) {
            event.currentTarget.value = result.normalized;
            onNormalizedChange?.(result.normalized);
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          // Keeps browser validation active when the form is submitted directly.
          const result = validatePhone(event.currentTarget.value);
          event.currentTarget.setCustomValidity(phoneErrorMessage(result.error, fr) ?? "");
          setError(null);
          props.onChange?.(event);
        }}
      />
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}
