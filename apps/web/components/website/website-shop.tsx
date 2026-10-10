"use client";

import * as React from "react";
import { CheckCircle2, Minus, PackageCheck, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { get, post } from "@/lib/api";

type Product = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  unit: string;
  unitLabel: string | null;
  price: number;
  currency: string;
  minimumQuantity: number;
  quantityStep: number;
  available: boolean;
};
type Catalog = {
  organizationName: string;
  settings: {
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    deliveryNote: string | null;
    paymentNote: string | null;
    orderNote: string | null;
  };
  categories: { id: string; nameFr: string; nameEn: string | null }[];
  products: Product[];
};
type Tracking = {
  number: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  total: number;
  currency: string;
  lines: { description: string; quantity: number; unit: string; unitPrice: number; total: number }[];
};
type Language = "fr" | "en";

const UNIT_FR: Record<string, string> = { egg: "œuf", bird: "volaille", kg: "kg" };
const UNIT_EN: Record<string, string> = { egg: "egg", bird: "bird", kg: "kg" };
const unitName = (product: { unit: string; unitLabel?: string | null }, language: Language) =>
  product.unitLabel || (language === "fr" ? UNIT_FR : UNIT_EN)[product.unit] || product.unit;
const money = (value: number, currency: string, language: Language) =>
  `${value.toLocaleString(language === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 2 })} ${currency === "CDF" ? "FC" : currency}`;

const copy = {
  fr: {
    all: "Tout",
    unavailable: "Épuisé",
    available: "Disponible",
    add: "Ajouter",
    cart: "Panier",
    emptyCart: "Votre panier est vide.",
    order: "Commander",
    total: "Total",
    name: "Nom complet",
    phone: "Téléphone / WhatsApp",
    email: "E-mail (facultatif)",
    delivery: "Livraison",
    pickup: "Retrait sur place",
    address: "Adresse de livraison",
    note: "Message (facultatif)",
    send: "Envoyer la commande",
    sending: "Envoi…",
    done: "Commande envoyée !",
    doneText: "Notre équipe vous appelle pour confirmer le prix, la disponibilité et la livraison. Gardez ce lien pour suivre votre commande :",
    follow: "Suivre ma commande",
    perUnit: "par",
    min: "Minimum",
    closed: "La boutique en ligne ouvre bientôt.",
    soon: "Aucun produit en vente pour le moment.",
    status: "Statut",
    yourOrder: "Votre commande",
    close: "Fermer",
    payNow: "Le paiement se fait à la confirmation (livraison ou mobile money).",
  },
  en: {
    all: "All",
    unavailable: "Sold out",
    available: "Available",
    add: "Add",
    cart: "Cart",
    emptyCart: "Your cart is empty.",
    order: "Order",
    total: "Total",
    name: "Full name",
    phone: "Phone / WhatsApp",
    email: "Email (optional)",
    delivery: "Delivery",
    pickup: "Pick-up",
    address: "Delivery address",
    note: "Message (optional)",
    send: "Send order",
    sending: "Sending…",
    done: "Order sent!",
    doneText: "Our team will call you to confirm price, availability and delivery. Keep this link to follow your order:",
    follow: "Follow my order",
    perUnit: "per",
    min: "Minimum",
    closed: "Our online shop opens soon.",
    soon: "No products for sale right now.",
    status: "Status",
    yourOrder: "Your order",
    close: "Close",
    payNow: "Payment is made on confirmation (delivery or mobile money).",
  },
};

const cartKey = (site: string) => `litehubs-shop-cart:${site}`;
function readCart(site: string): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(cartKey(site)) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function writeCart(site: string, cart: Record<string, number>) {
  try {
    window.localStorage.setItem(cartKey(site), JSON.stringify(cart));
  } catch {
    /* private browsing */
  }
}

/** "Boutique" block of the public website: products from LiteHubs (Ventes),
 * cart and order request.  Payment happens when the team confirms. */
export function WebsiteShop({
  site,
  language,
  color,
  editing,
}: {
  site: string;
  language: Language;
  color: string;
  editing?: boolean;
}) {
  const t = copy[language] ?? copy.fr;
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [category, setCategory] = React.useState<string | null>(null);
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", phone: "", email: "", mode: "delivery" as "delivery" | "pickup", address: "", note: "" });
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [placed, setPlaced] = React.useState<{ number: string; link: string } | null>(null);
  const [tracking, setTracking] = React.useState<Tracking | null>(null);
  const base = `/public/shop/${encodeURIComponent(site)}`;

  React.useEffect(() => {
    get<Catalog>(base)
      .then((data) => {
        setCatalog(data);
        setForm((current) => ({ ...current, mode: data.settings.deliveryEnabled ? "delivery" : "pickup" }));
      })
      .catch(() => setFailed(true));
    setCart(readCart(site));
    // Tracking link: ?commande=<token>
    const token = new URLSearchParams(window.location.search).get("commande");
    if (token)
      get<Tracking>(`${base}/orders/${encodeURIComponent(token)}`)
        .then(setTracking)
        .catch(() => undefined);
  }, [base, site]);

  const updateCart = (next: Record<string, number>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, quantity]) => quantity > 0));
    setCart(clean);
    writeCart(site, clean);
  };

  if (failed || (catalog && !catalog.products.length))
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-slate-600">
        <ShoppingBag className="mx-auto mb-3 size-8 text-slate-400" />
        {failed ? t.closed : t.soon}
        {editing ? (
          <p className="mt-2 text-xs text-slate-500">
            {language === "fr"
              ? "Activez la boutique et choisissez les produits dans LiteHubs → Boutique en ligne."
              : "Turn on the shop and choose products in LiteHubs → Online shop."}
          </p>
        ) : null}
      </div>
    );
  if (!catalog) return <div className="h-48 animate-pulse rounded-3xl bg-slate-100" />;

  const products = catalog.products.filter((product) => !category || product.categoryId === category);
  const items = Object.entries(cart)
    .map(([id, quantity]) => ({ product: catalog.products.find((product) => product.id === id), quantity }))
    .filter((item): item is { product: Product; quantity: number } => Boolean(item.product));
  const count = items.length;
  const currency = items[0]?.product.currency ?? catalog.products[0]?.currency ?? "CDF";
  const total = items.reduce((sum, item) => sum + item.quantity * item.product.price, 0);
  const add = (product: Product) => {
    const current = cart[product.id] ?? 0;
    updateCart({ ...cart, [product.id]: current ? current + product.quantityStep : Math.max(product.minimumQuantity, product.quantityStep) });
  };
  const change = (product: Product, delta: number) => {
    const next = (cart[product.id] ?? 0) + delta * product.quantityStep;
    updateCart({ ...cart, [product.id]: next < product.minimumQuantity ? 0 : next });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (editing) return;
    setSending(true);
    setError(null);
    try {
      const result = await post<{ number: string; token: string }>(`${base}/orders`, {
        items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        deliveryMode: form.mode,
        address: form.mode === "delivery" ? form.address : undefined,
        note: form.note || undefined,
      });
      const url = new URL(window.location.href);
      url.searchParams.set("commande", result.token);
      setPlaced({ number: result.number, link: url.toString() });
      updateCart({});
    } catch (cause) {
      setError(
        (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          (language === "fr" ? "Commande non envoyée. Réessayez." : "Order not sent. Please try again."),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {tracking ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-slate-500">{t.yourOrder}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{tracking.number}</p>
              <p className="mt-1 text-sm text-slate-600">
                {t.status} : <strong style={{ color }}>{tracking.statusLabel}</strong>
              </p>
            </div>
            <button type="button" onClick={() => setTracking(null)} aria-label={t.close} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
              <X className="size-5" />
            </button>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {tracking.lines.map((line, index) => (
              <li key={index} className="flex justify-between gap-3 py-2">
                <span>
                  {line.description} × {line.quantity}
                </span>
                <span className="font-medium">{money(line.total, tracking.currency, language)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right font-semibold">
            {t.total} : {money(tracking.total, tracking.currency, language)}
          </p>
        </div>
      ) : null}

      {catalog.categories.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {[{ id: null as string | null, label: t.all }, ...catalog.categories.map((item) => ({ id: item.id as string | null, label: (language === "en" && item.nameEn) || item.nameFr }))].map((item) => (
            <button
              key={item.id ?? "all"}
              type="button"
              onClick={() => setCategory(item.id)}
              className="rounded-full border px-4 py-1.5 text-sm font-semibold transition"
              style={category === item.id ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e2e8f0", color: "#334155" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const quantity = cart[product.id] ?? 0;
          return (
            <article key={product.id} className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative aspect-[4/3] bg-slate-100">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.title} className="size-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid size-full place-items-center text-slate-300">
                    <ShoppingBag className="size-10" />
                  </div>
                )}
                <span
                  className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold ${product.available ? "bg-white/95 text-emerald-700" : "bg-slate-900/80 text-white"}`}
                >
                  {product.available ? t.available : t.unavailable}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="text-base font-semibold text-slate-900">{product.title}</h3>
                {product.description ? <p className="line-clamp-3 text-sm text-slate-600">{product.description}</p> : null}
                <p className="mt-auto text-lg font-bold text-slate-900">
                  {money(product.price, product.currency, language)}{" "}
                  <span className="text-sm font-medium text-slate-500">
                    {t.perUnit} {unitName(product, language)}
                  </span>
                </p>
                {product.minimumQuantity > 1 ? (
                  <p className="text-xs text-slate-500">
                    {t.min} {product.minimumQuantity} {unitName(product, language)}
                  </p>
                ) : null}
                {quantity ? (
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-1">
                    <button type="button" onClick={() => change(product, -1)} className="grid size-9 place-items-center rounded-xl hover:bg-slate-100" aria-label="-">
                      <Minus className="size-4" />
                    </button>
                    <span className="text-sm font-semibold">
                      {quantity} {unitName(product, language)}
                    </span>
                    <button type="button" onClick={() => change(product, 1)} className="grid size-9 place-items-center rounded-xl hover:bg-slate-100" aria-label="+">
                      <Plus className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!product.available}
                    onClick={() => add(product)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white disabled:opacity-40"
                    style={{ background: color }}
                  >
                    <Plus className="size-4" />
                    {t.add}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {count ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-[59] inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-white shadow-xl sm:bottom-6 sm:left-6"
          style={{ background: color }}
        >
          <ShoppingBag className="size-5" />
          {t.cart} · {money(total, currency, language)}
          <span className="rounded-full bg-white px-1.5 text-xs font-bold" style={{ color }}>
            {count}
          </span>
        </button>
      ) : null}

      {open || placed ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal>
          <div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white text-slate-900 shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <p className="flex items-center gap-2 text-lg font-semibold">
                <ShoppingBag className="size-5" style={{ color }} />
                {placed ? t.done : t.cart}
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPlaced(null);
                }}
                aria-label={t.close}
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="size-5" />
              </button>
            </div>
            {placed ? (
              <div className="space-y-4 p-5 text-sm">
                <p className="flex items-center gap-2 text-base font-semibold text-emerald-700">
                  <CheckCircle2 className="size-5" />
                  {placed.number}
                </p>
                <p className="text-slate-600">{t.doneText}</p>
                <a href={placed.link} className="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 font-semibold text-white" style={{ background: color }}>
                  <PackageCheck className="size-4" />
                  {t.follow}
                </a>
                <p className="break-all rounded-xl bg-slate-50 p-2 text-xs text-slate-500">{placed.link}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {items.length ? (
                  <ul className="divide-y divide-slate-100">
                    {items.map(({ product, quantity }) => (
                      <li key={product.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{product.title}</span>
                          <span className="text-slate-500">
                            {quantity} {unitName(product, language)} × {money(product.price, product.currency, language)}
                          </span>
                        </span>
                        <span className="font-semibold">{money(quantity * product.price, product.currency, language)}</span>
                        <button type="button" onClick={() => updateCart({ ...cart, [product.id]: 0 })} className="rounded-full p-1 text-slate-400 hover:text-red-600" aria-label="Retirer">
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{t.emptyCart}</p>
                )}
                <p className="flex justify-between border-t border-slate-100 pt-3 text-base font-bold">
                  <span>{t.total}</span>
                  <span>{money(total, currency, language)}</span>
                </p>
                {items.length ? (
                  <>
                    <div className="grid gap-3">
                      <input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t.name} className="h-11 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-slate-500" />
                      <input required minLength={6} maxLength={40} inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder={t.phone} className="h-11 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-slate-500" />
                      <input type="email" maxLength={200} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder={t.email} className="h-11 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-slate-500" />
                      <div className="flex gap-2">
                        {catalog.settings.deliveryEnabled ? (
                          <label className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${form.mode === "delivery" ? "border-slate-900" : "border-slate-200"}`}>
                            <input type="radio" name="mode" checked={form.mode === "delivery"} onChange={() => setForm({ ...form, mode: "delivery" })} />
                            {t.delivery}
                          </label>
                        ) : null}
                        {catalog.settings.pickupEnabled ? (
                          <label className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${form.mode === "pickup" ? "border-slate-900" : "border-slate-200"}`}>
                            <input type="radio" name="mode" checked={form.mode === "pickup"} onChange={() => setForm({ ...form, mode: "pickup" })} />
                            {t.pickup}
                          </label>
                        ) : null}
                      </div>
                      {form.mode === "delivery" ? (
                        <textarea required maxLength={500} rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder={t.address} className="rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-slate-500" />
                      ) : null}
                      <textarea maxLength={1000} rows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder={t.note} className="rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-slate-500" />
                    </div>
                    <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      {form.mode === "delivery" && catalog.settings.deliveryNote ? <p>{catalog.settings.deliveryNote}</p> : null}
                      <p>{catalog.settings.paymentNote || t.payNow}</p>
                      {catalog.settings.orderNote ? <p>{catalog.settings.orderNote}</p> : null}
                    </div>
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    <button type="submit" disabled={sending || editing} className="h-12 w-full rounded-2xl text-base font-semibold text-white disabled:opacity-60" style={{ background: color }}>
                      {sending ? t.sending : t.send}
                    </button>
                  </>
                ) : null}
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
