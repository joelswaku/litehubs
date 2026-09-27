export type PhoneValidationResult = {
  normalized: string;
  error: "drc" | "international" | null;
};

/**
 * Turns the common local Congolese formats into E.164 while preserving an
 * explicitly international number. A database / provider always receives the
 * canonical form, e.g. +243898869772.
 */
export function normalizePhone(value: string): string {
  const raw = value.trim();
  if (!raw) return "";

  const explicitInternational = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (!explicitInternational) {
    if (digits.startsWith("243")) {
      // Already includes the country code, only the + is missing.
    } else if (digits.startsWith("0")) {
      digits = `243${digits.slice(1)}`;
    } else {
      digits = `243${digits}`;
    }
  }

  return `+${digits}`;
}

export function validatePhone(value: string): PhoneValidationResult {
  const normalized = normalizePhone(value);
  if (!normalized) return { normalized, error: null };

  // RDC mobile: country code + 9 national digits beginning with 8 or 9.
  if (normalized.startsWith("+243")) {
    return {
      normalized,
      error: /^\+243[89]\d{8}$/.test(normalized) ? null : "drc",
    };
  }

  return {
    normalized,
    error: /^\+[1-9]\d{7,14}$/.test(normalized) ? null : "international",
  };
}

export function phoneErrorMessage(error: PhoneValidationResult["error"], fr: boolean): string | null {
  if (!error) return null;
  if (error === "drc") {
    return fr
      ? "Pour la RDC, saisissez 9 chiffres après +243. Exemple : +243 898 869 772."
      : "For the DRC, enter 9 digits after +243. Example: +243 898 869 772.";
  }
  return fr
    ? "Saisissez un numéro international valide, par exemple +243 898 869 772."
    : "Enter a valid international number, for example +243 898 869 772.";
}
