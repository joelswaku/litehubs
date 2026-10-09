import type { CSSProperties } from "react";
import { BriefcaseBusiness } from "lucide-react";

/** Identity from the company's Website settings (logo and colours). */
export type CareersBranding = {
  displayName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
};

const HEX = /^#[0-9a-f]{6}$/i;
const safeColor = (value?: string | null) => (value && HEX.test(value) ? value : null);

/** Re-colours every brand-tinted control on the careers pages. */
export function careersBrandStyle(branding?: CareersBranding | null): CSSProperties | undefined {
  const primary = safeColor(branding?.primaryColor);
  if (!primary) return undefined;
  return {
    "--brand": primary,
    "--brand-hover": `color-mix(in srgb, ${primary} 88%, black)`,
    "--brand-active": `color-mix(in srgb, ${primary} 78%, black)`,
    "--brand-subtle": `color-mix(in srgb, ${primary} 12%, white)`,
    "--brand-ink": "#ffffff",
  } as CSSProperties;
}

/** Hero banner in the company colours instead of the default LiteHubs blue. */
export function careersHeroStyle(branding?: CareersBranding | null): CSSProperties | undefined {
  const primary = safeColor(branding?.primaryColor);
  if (!primary) return undefined;
  const accent = safeColor(branding?.accentColor) ?? primary;
  return {
    backgroundImage: `radial-gradient(circle at 85% -25%, color-mix(in srgb, ${accent} 45%, transparent), transparent 45%), linear-gradient(125deg, color-mix(in srgb, ${primary} 62%, black), ${primary})`,
  };
}

/** The company logo; falls back to a neutral mark and the name. */
export function CareersBrandMark({
  branding,
  organizationName,
  href,
}: {
  branding?: CareersBranding | null;
  organizationName: string;
  href: string;
}) {
  return (
    <a href={href} className="flex min-w-0 shrink items-center gap-2.5 font-semibold text-ink" aria-label={organizationName}>
      {branding?.logoUrl ? (
        <img
          src={branding.logoUrl}
          alt={organizationName}
          className="h-10 w-auto max-w-[140px] object-contain sm:h-12 sm:max-w-[200px]"
        />
      ) : (
        <>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm">
            <BriefcaseBusiness className="size-5" />
          </span>
          <span className="hidden truncate sm:inline">{organizationName}</span>
        </>
      )}
    </a>
  );
}
