"use client";

/**
 * Header and footer shared by the LiteHubs public pages (home, product pages,
 * privacy policy). Fixed, translucent header that firms up on scroll, with a
 * drawer on phones; dark footer with the product links and the company line.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, LogIn, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { useLanguage } from "@/providers/language-provider";
import { cn } from "@/lib/utils";

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);

export const COMPANY_NAME = "Lakenah LLC";

function productLinks(fr: boolean) {
  return [
    { href: "/logiciel/gestion-avicole", label: tr(fr, "Aviculture", "Poultry") },
    { href: "/logiciel/elevage-porcin", label: tr(fr, "Élevage porcin", "Pig farming") },
    { href: "/logiciel/gestion-agricole", label: tr(fr, "Agriculture", "Crops") },
    { href: "/logiciel/equipes-rh", label: tr(fr, "Équipes et RH", "Teams and HR") },
  ];
}

export function SiteHeader() {
  const { locale, setLocale } = useLanguage();
  const fr = locale === "fr";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [...productLinks(fr), { href: "/contact", label: "Contact" }];

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled || open
            ? "border-b border-border bg-page/90 shadow-sm backdrop-blur-xl"
            : "bg-page/60 backdrop-blur-md",
        )}
      >
        <nav
          className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10"
          aria-label={tr(fr, "Navigation principale", "Main navigation")}
        >
          <Link href="/" className="flex items-center gap-2.5" aria-label={tr(fr, "Accueil LiteHubs", "LiteHubs home")}>
            <BrandMark size={32} className="rounded-lg shadow-sm" />
            <span className="text-lg font-semibold tracking-[-0.04em] text-ink">LiteHubs</span>
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-ink-secondary lg:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="transition-colors hover:text-ink">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <div className="flex rounded-md border border-border bg-surface-1 p-0.5" aria-label="Language">
              {(["fr", "en"] as const).map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => setLocale(next)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors",
                    locale === next ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {next}
                </button>
              ))}
            </div>
            <Link
              href="/contact?sujet=demo"
              className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink-secondary transition hover:bg-surface-2 hover:text-ink"
            >
              <CalendarDays className="size-4" aria-hidden />
              {tr(fr, "Démo", "Demo")}
            </Link>
            <a
              href="/login"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-page shadow-sm transition hover:opacity-90"
            >
              {tr(fr, "Se connecter", "Sign in")}
              <LogIn className="size-4" aria-hidden />
            </a>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-ink-secondary transition hover:bg-surface-2 hover:text-ink lg:hidden"
            aria-label={open ? tr(fr, "Fermer le menu", "Close menu") : tr(fr, "Ouvrir le menu", "Open menu")}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </nav>
      </header>

      {open ? (
        <div className="fixed inset-x-0 top-16 z-40 border-b border-border bg-page px-5 pb-5 pt-2 shadow-lg lg:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block border-b border-border/60 py-3 text-sm font-medium text-ink"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-4 grid gap-2">
            <Link
              href="/contact?sujet=demo"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border py-2.5 text-center text-sm font-semibold text-ink"
            >
              {tr(fr, "Demander une démo", "Book a demo")}
            </Link>
            <a href="/login" className="rounded-lg bg-ink py-2.5 text-center text-sm font-semibold text-page">
              {tr(fr, "Se connecter", "Sign in")}
            </a>
            <div className="mt-1 flex justify-center gap-2">
              {(["fr", "en"] as const).map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => setLocale(next)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-bold uppercase",
                    locale === next ? "bg-surface-3 text-ink" : "text-ink-muted",
                  )}
                >
                  {next}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SiteFooter() {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const year = new Date().getFullYear();
  const columns = [
    { title: tr(fr, "Logiciels", "Software"), links: productLinks(fr) },
    {
      title: tr(fr, "Entreprise", "Company"),
      links: [
        { href: "/contact", label: "Contact" },
        { href: "/contact?sujet=demo", label: tr(fr, "Demander une démo", "Request a demo") },
        { href: "/confidentialite", label: tr(fr, "Confidentialité", "Privacy") },
      ],
    },
    {
      title: tr(fr, "Accès", "Access"),
      links: [
        { href: "/login", label: tr(fr, "Se connecter", "Sign in") },
        { href: "/forgot-password", label: tr(fr, "Mot de passe oublié", "Forgot password") },
      ],
    },
  ];
  return (
    <footer className="bg-[#0b1220] text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-10">
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark size={30} className="rounded-lg bg-white" />
            <span className="text-lg font-semibold tracking-[-0.04em] text-white">LiteHubs</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-slate-400">
            {tr(
              fr,
              "Le logiciel de gestion avicole, porcine et agricole pour les entreprises qui avancent.",
              "Poultry, pig and farm management software for businesses that move forward.",
            )}
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {tr(fr, `Un produit de ${COMPANY_NAME}`, `A ${COMPANY_NAME} product`)}
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-sm font-semibold text-white">{column.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-slate-400 transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>
            © {year} LiteHubs — {COMPANY_NAME}. {tr(fr, "Tous droits réservés.", "All rights reserved.")}
          </p>
          <p>{tr(fr, "LiteHubs est un produit de Lakenah LLC.", "LiteHubs is a product of Lakenah LLC.")}</p>
        </div>
      </div>
    </footer>
  );
}
