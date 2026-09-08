"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Building2, Check, ShieldCheck, Users } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { APP_NAME } from "@/lib/constants";
import { useLanguage } from "@/providers/language-provider";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const benefits = [
    t("auth.benefitOne"),
    t("auth.benefitTwo"),
    t("auth.benefitThree"),
  ];

  return (
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(430px,0.92fr)]">
      <aside className="relative hidden h-dvh overflow-hidden bg-[#10291f] text-white lg:sticky lg:top-0 lg:flex lg:flex-col lg:p-10 xl:p-14">
        <motion.div
          className="pointer-events-none absolute -left-32 top-28 size-[34rem] rounded-full border border-white/10"
          animate={
            reduceMotion
              ? undefined
              : { scale: [1, 1.06, 1], rotate: [0, 7, 0] }
          }
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -bottom-64 -right-48 size-[38rem] rounded-full bg-[#1a5a40]/55 blur-3xl"
          animate={
            reduceMotion
              ? undefined
              : { x: [0, -25, 0], y: [0, -20, 0], scale: [1, 1.08, 1] }
          }
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute right-20 top-20 size-32 rounded-full border border-white/10"
          animate={reduceMotion ? undefined : { y: [0, 18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative z-10 flex items-center justify-between gap-4">
          <Link
            href="/login"
            className="inline-flex w-fit items-center gap-3 text-sm font-semibold tracking-tight text-white"
          >
            <BrandMark size={36} className="rounded-lg ring-1 ring-white/25" />
            <span>{APP_NAME}</span>
          </Link>
          <LanguageSwitcher inverse />
        </div>

        <motion.div
          className="relative z-10 my-auto max-w-xl py-14"
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
        >
          <motion.p
            className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200"
            initial={reduceMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12, duration: 0.45 }}
          >
            {t("auth.kicker")}
          </motion.p>
          <motion.h1
            className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-white xl:text-5xl"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.55, ease: "easeOut" }}
          >
            {t("auth.title")}
          </motion.h1>
          <motion.p
            className="mt-6 max-w-lg text-base leading-7 text-emerald-50/80 xl:text-lg"
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.5, ease: "easeOut" }}
          >
            {t("auth.description")}
          </motion.p>
          <ul className="mt-9 space-y-4">
            {benefits.map((benefit, index) => (
              <motion.li
                key={benefit}
                className="flex items-start gap-3 text-sm leading-6 text-white/90"
                initial={reduceMotion ? false : { opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: 0.38 + index * 0.1,
                  duration: 0.42,
                  ease: "easeOut",
                }}
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-100/20">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
                <span>{benefit}</span>
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <div className="relative z-10 grid grid-cols-2 gap-3 border-t border-white/15 pt-7">
          <motion.div
            className="rounded-xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={
              reduceMotion
                ? { opacity: 1, y: 0 }
                : { opacity: 1, y: [0, -5, 0] }
            }
            transition={
              reduceMotion
                ? { duration: 0.35 }
                : {
                    opacity: { duration: 0.45, delay: 0.66 },
                    y: {
                      duration: 5.5,
                      delay: 1,
                      repeat: Infinity,
                      ease: "easeInOut",
                    },
                  }
            }
          >
            <Building2 className="mb-5 size-5 text-emerald-200" aria-hidden />
            <p className="text-sm font-semibold">{t("auth.companyHub")}</p>
            <p className="mt-1 text-xs leading-5 text-emerald-50/65">
              {t("auth.companyHubDescription")}
            </p>
          </motion.div>
          <motion.div
            className="rounded-xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={
              reduceMotion
                ? { opacity: 1, y: 0 }
                : { opacity: 1, y: [0, -5, 0] }
            }
            transition={
              reduceMotion
                ? { duration: 0.35 }
                : {
                    opacity: { duration: 0.45, delay: 0.76 },
                    y: {
                      duration: 5.5,
                      delay: 1.8,
                      repeat: Infinity,
                      ease: "easeInOut",
                    },
                  }
            }
          >
            <ShieldCheck className="mb-5 size-5 text-emerald-200" aria-hidden />
            <p className="text-sm font-semibold">{t("auth.private")}</p>
            <p className="mt-1 text-xs leading-5 text-emerald-50/65">
              {t("auth.privateDescription")}
            </p>
          </motion.div>
        </div>
      </aside>
      <section className="flex min-h-dvh flex-col bg-page">
        <header className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Link
            href="/login"
            className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink"
          >
            <BrandMark size={30} className="rounded-lg" />
            <span>{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-ink-muted sm:inline-flex">
              <Users className="size-3.5" aria-hidden />
              {t("auth.companyWorkspace")}
            </span>
            <LanguageSwitcher />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
          <div className="w-full max-w-[27rem]">{children}</div>
        </main>
        <footer className="px-6 py-6 text-center text-xs text-ink-muted lg:text-left">
          {t("auth.footer")}
        </footer>
      </section>
    </div>
  );
}
