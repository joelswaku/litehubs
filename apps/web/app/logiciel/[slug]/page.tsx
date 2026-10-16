import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { APP_NAME } from "@/lib/constants";
import { MARKETING_PAGES, marketingPage } from "@/lib/marketing-pages";
import { INDEXABLE, publicUrl, serializeJsonLd } from "@/lib/seo";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return MARKETING_PAGES.map((page) => ({ slug: page.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = marketingPage((await params).slug);
  if (!page) return {};
  const path = `/logiciel/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    keywords: page.keywords,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: APP_NAME,
      url: publicUrl(path),
      title: `${page.title} | ${APP_NAME}`,
      description: page.description,
      images: [{ url: publicUrl("/opengraph-image"), width: 1200, height: 630, alt: page.h1 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.title} | ${APP_NAME}`,
      description: page.description,
      images: [publicUrl("/opengraph-image")],
    },
    robots: INDEXABLE,
  };
}

/** Rendered on the server: crawlers receive the full text without running JS. */
export default async function SoftwarePage({ params }: { params: Promise<Params> }) {
  const page = marketingPage((await params).slug);
  if (!page) notFound();
  const path = `/logiciel/${page.slug}`;
  const others = MARKETING_PAGES.filter((item) => item.slug !== page.slug);

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": publicUrl(`${path}#webpage`),
        url: publicUrl(path),
        name: page.title,
        description: page.description,
        inLanguage: "fr",
        isPartOf: { "@id": publicUrl("/#website") },
        about: { "@id": publicUrl("/#software") },
        breadcrumb: { "@id": publicUrl(`${path}#breadcrumb`) },
      },
      {
        "@type": "BreadcrumbList",
        "@id": publicUrl(`${path}#breadcrumb`),
        itemListElement: [
          { "@type": "ListItem", position: 1, name: APP_NAME, item: publicUrl("/") },
          { "@type": "ListItem", position: 2, name: page.h1, item: publicUrl(path) },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": publicUrl(`${path}#faq`),
        mainEntity: page.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };

  return (
    <main className="min-h-dvh bg-page pt-16 text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <SiteHeader />

      <article>
        <section className="mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pt-16">
          <nav aria-label="Fil d’Ariane" className="text-xs text-ink-muted">
            <Link href="/" className="hover:text-ink">LiteHubs</Link>
            <span className="mx-1.5">/</span>
            <span>{page.eyebrow.charAt(0) + page.eyebrow.slice(1).toLowerCase()}</span>
          </nav>
          <p className="mt-6 text-xs font-bold tracking-[0.14em] text-brand">{page.eyebrow}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
            {page.h1}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">{page.intro}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/rendezvous" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-brand-ink hover:bg-brand-hover">
              Demander une démonstration <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/contact" className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface-1 px-5 text-sm font-semibold hover:bg-surface-2">
              Nous contacter
            </Link>
          </div>
        </section>

        <section className="border-y border-border bg-surface-2/60">
          <div className="mx-auto grid max-w-6xl gap-4 px-5 py-14 sm:px-8 md:grid-cols-2">
            {page.sections.map((section) => (
              <div key={section.title} className="rounded-xl border border-border bg-surface-1 p-6">
                <h2 className="text-lg font-semibold tracking-[-0.025em]">{section.title}</h2>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">{section.text}</p>
                <ul className="mt-4 space-y-2">
                  {section.points.map((point) => (
                    <li key={point} className="flex gap-2 text-sm leading-6">
                      <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 className="text-2xl font-semibold tracking-[-0.04em]">Pourquoi choisir LiteHubs</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {page.benefits.map((benefit) => (
              <li key={benefit} className="flex gap-2 rounded-lg border border-border bg-surface-1 p-4 text-sm leading-6">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
                {benefit}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8">
          <h2 className="text-2xl font-semibold tracking-[-0.04em]">Questions fréquentes</h2>
          <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface-1">
            {page.faq.map((item) => (
              <div key={item.question} className="p-5">
                <h3 className="font-semibold">{item.question}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-surface-2/60">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
            <h2 className="text-xl font-semibold tracking-[-0.03em]">Découvrir aussi</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {others.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/logiciel/${other.slug}`}
                    className="flex h-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 p-4 text-sm font-semibold hover:border-brand/40"
                  >
                    {other.h1}
                    <ArrowRight className="size-4 shrink-0 text-brand" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </article>

      <SiteFooter />
    </main>
  );
}
