export function normalizePhone(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const explicitInternational = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!explicitInternational) {
    if (digits.startsWith("243")) {
      // The local number already includes the DRC country code.
    } else if (digits.startsWith("0")) {
      digits = `243${digits.slice(1)}`;
    } else {
      digits = `243${digits}`;
    }
  }
  return `+${digits}`;
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  if (normalized.startsWith("+243")) return /^\+243[89]\d{8}$/.test(normalized);
  return /^\+[1-9]\d{7,14}$/.test(normalized);
}
