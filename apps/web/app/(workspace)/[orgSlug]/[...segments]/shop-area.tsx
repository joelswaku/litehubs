"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Eye, EyeOff, ImagePlus, Pencil, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, del, get, orgUrl, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Category = { id: string; nameFr: string; nameEn: string | null; sortOrder: number; isVisible: boolean };
type Product = {
  id: string;
  code: string;
  title: string;
  sourceType: string;
  unit: string;
  price: number | null;
  currency: string;
  minimumQuantity: number;
  isAvailable: boolean;
  availableQuantity: number;
  saleReady: boolean;
  blockedUntil: string | null;
  web: {
    visible: boolean;
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    categoryId: string | null;
    sortOrder: number;
    quantityStep: number;
    unitLabel: string | null;
  };
};
type Settings = {
  enabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryNote: string | null;
  paymentNote: string | null;
  orderNote: string | null;
};
type Overview = { settings: Settings; categories: Category[]; products: Product[]; pendingOrders: number; canSeeOrders: boolean; siteSlug: string };
type Order = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  total: number;
  currency: string;
  contact: { name: string | null; phone: string | null; email: string | null };
  deliveryMode: "delivery" | "pickup" | null;
  deliveryAddress: string | null;
  note: string | null;
  cancelledReason: string | null;
  lines: { description: string; quantity: number; unit: string; unitPrice: number; total: number }[];
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
  (error instanceof Error ? error.message : "");
const money = (value: number, currency: string) => `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency === "CDF" ? "FC" : currency}`;
const SOURCE: Record<string, [string, string]> = {
  egg_flock: ["Œufs (bande)", "Eggs (flock)"],
  poultry_flock: ["Volailles (bande)", "Poultry (flock)"],
  pig_group: ["Porcs (groupe)", "Pigs (group)"],
  pig_animal: ["Porc", "Pig"],
  harvest_planting: ["Récolte", "Harvest"],
  inventory_item: ["Stock", "Inventory"],
};
const STATUS: Record<string, [string, string]> = {
  draft: ["À confirmer", "To confirm"],
  confirmed: ["Confirmée", "Confirmed"],
  partially_delivered: ["En partie livrée", "Partly delivered"],
  delivered: ["Livrée", "Delivered"],
  invoiced: ["Facturée", "Invoiced"],
  cancelled: ["Annulée", "Cancelled"],
};

export function ShopArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const [tab, setTab] = useState<"orders" | "products" | "categories" | "settings">("products");
  const overview = useQuery({ queryKey: ["shop", orgSlug], queryFn: () => get<Overview>(orgUrl(orgSlug, "shop")), refetchInterval: 30_000 });
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "orders" || wanted === "products" || wanted === "categories" || wanted === "settings") setTab(wanted);
  }, []);

  if (overview.isLoading) return <div className="p-4 sm:p-6"><SkeletonCard rows={6} /></div>;
  if (overview.isError || !overview.data)
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title={tr(fr, "Boutique indisponible", "Shop unavailable")} description={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
      </div>
    );
  const data = overview.data;
  const visibleCount = data.products.filter((item) => item.web.visible).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
          <ShoppingBag className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-ink">{tr(fr, "Boutique en ligne", "Online shop")}</h1>
          <p className="text-sm text-ink-secondary">
            {data.settings.enabled
              ? tr(fr, `Ouverte · ${visibleCount} produit(s) sur le site`, `Open · ${visibleCount} product(s) on the website`)
              : tr(fr, "Fermée : les clients ne voient pas encore les produits.", "Closed: customers can't see products yet.")}
          </p>
        </div>
        <a
          href={`/sites/${data.siteSlug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2"
        >
          <ExternalLink className="size-4" />
          {tr(fr, "Voir le site", "View website")}
        </a>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-1 p-1">
        {(
          [
            ...(data.canSeeOrders ? [{ key: "orders", label: tr(fr, "Commandes", "Orders"), count: data.pendingOrders }] : []),
            { key: "products", label: tr(fr, "Produits", "Products"), count: 0 },
            { key: "categories", label: tr(fr, "Catégories", "Categories"), count: 0 },
            { key: "settings", label: tr(fr, "Réglages", "Settings"), count: 0 },
          ] as { key: typeof tab; label: string; count: number }[]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${tab === item.key ? "bg-brand/10 text-brand" : "text-ink-secondary hover:bg-surface-2"}`}
          >
            {item.label}
            {item.count ? <span className="rounded-full bg-critical px-1.5 text-[11px] font-bold text-white">{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "orders" && data.canSeeOrders ? <Orders orgSlug={orgSlug} fr={fr} /> : null}
      {tab === "products" ? <Products orgSlug={orgSlug} fr={fr} data={data} /> : null}
      {tab === "categories" ? <Categories orgSlug={orgSlug} fr={fr} categories={data.categories} /> : null}
      {tab === "settings" ? <SettingsPanel orgSlug={orgSlug} fr={fr} settings={data.settings} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Products({ orgSlug, fr, data }: { orgSlug: string; fr: boolean; data: Overview }) {
  const [editing, setEditing] = useState<Product | null>(null);
  if (!data.products.length)
    return (
      <EmptyState
        icon={ShoppingBag}
        title={tr(fr, "Aucun produit à vendre", "No sellable product")}
        description={tr(
          fr,
          "Créez d’abord une offre dans Ventes (œufs d’une bande, volailles, porcs, récolte ou article de stock). Elle apparaîtra ici pour être mise sur le site.",
          "First create an offer in Sales (eggs, poultry, pigs, harvest or inventory). It will appear here to put on the website.",
        )}
      />
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-secondary">
        {tr(fr, "Les produits viennent des offres de ", "Products come from the offers in ")}
        <Link href={`/${orgSlug}/sales`} className="font-semibold text-brand hover:underline">
          {tr(fr, "Ventes", "Sales")}
        </Link>
        {tr(
          fr,
          " : le stock se calcule tout seul avec la production. Ici, vous choisissez ce que les clients voient.",
          ": stock follows production automatically. Here you choose what customers see.",
        )}
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface-1">
        {data.products.map((product) => (
          <div key={product.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
              {product.web.imageUrl ? (
                <img src={product.web.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-ink-muted">
                  <ShoppingBag className="size-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{product.web.title || product.title}</p>
              <p className="text-xs text-ink-secondary">
                {(SOURCE[product.sourceType] ?? [product.sourceType, product.sourceType])[fr ? 0 : 1]} · {tr(fr, "stock", "stock")}{" "}
                {product.availableQuantity.toLocaleString("fr-FR")} {product.unit}
                {product.price !== null ? ` · ${money(product.price, product.currency)} / ${product.web.unitLabel || product.unit}` : ` · ${tr(fr, "pas de prix", "no price")}`}
              </p>
              {product.blockedUntil ? (
                <p className="text-xs font-medium text-warning">
                  {tr(fr, `Délai d’attente sanitaire jusqu’au ${product.blockedUntil} : affiché « Épuisé »`, `Withdrawal period until ${product.blockedUntil}: shown as sold out`)}
                </p>
              ) : !product.isAvailable ? (
                <p className="text-xs font-medium text-warning">{tr(fr, "Marqué indisponible", "Marked unavailable")}</p>
              ) : null}
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${product.web.visible ? "bg-good/15 text-good" : "bg-surface-2 text-ink-muted"}`}
            >
              {product.web.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {product.web.visible ? tr(fr, "Sur le site", "On website") : tr(fr, "Caché", "Hidden")}
            </span>
            <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
              <Pencil className="size-4" />
              {tr(fr, "Modifier", "Edit")}
            </Button>
          </div>
        ))}
      </div>
      {editing ? <ProductDialog orgSlug={orgSlug} fr={fr} product={editing} categories={data.categories} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ProductDialog({ orgSlug, fr, product, categories, onClose }: { orgSlug: string; fr: boolean; product: Product; categories: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    visible: product.web.visible,
    title: product.web.title ?? product.title,
    description: product.web.description ?? "",
    imageUrl: product.web.imageUrl,
    categoryId: product.web.categoryId ?? "",
    unitLabel: product.web.unitLabel ?? "",
    quantityStep: String(product.web.quantityStep || 1),
    sortOrder: String(product.web.sortOrder || 0),
    price: product.price === null ? "" : String(product.price),
    minimumQuantity: String(product.minimumQuantity || 0),
    isAvailable: product.isAvailable,
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () =>
      put<Overview>(orgUrl(orgSlug, `shop/products/${product.id}`), {
        price: form.price.trim() === "" ? null : Number(form.price),
        isAvailable: form.isAvailable,
        minimumQuantity: Number(form.minimumQuantity) || 0,
        web: {
          visible: form.visible,
          title: form.title,
          description: form.description,
          imageUrl: form.imageUrl,
          categoryId: form.categoryId || null,
          unitLabel: form.unitLabel,
          quantityStep: Number(form.quantityStep) || 1,
          sortOrder: Number(form.sortOrder) || 0,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["shop", orgSlug], data);
      toast.success(tr(fr, "Produit enregistré.", "Product saved."));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post<{ url: string }>(orgUrl(orgSlug, "shop/images"), body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm((current) => ({ ...current, imageUrl: data.url }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  const field = "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink";
  return (
    <Dialog title={tr(fr, "Produit sur le site", "Product on the website")} onClose={onClose}>
      <div className="space-y-3 p-5">
        <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-medium text-ink">
          <input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} />
          {tr(fr, "Afficher ce produit sur le site", "Show this product on the website")}
        </label>
        <div className="flex gap-3">
          <div className="size-24 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
            {form.imageUrl ? <img src={form.imageUrl} alt="" className="size-full object-cover" /> : null}
          </div>
          <div className="flex flex-col justify-center gap-1.5">
            <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" />
              {form.imageUrl ? tr(fr, "Changer la photo", "Change photo") : tr(fr, "Ajouter une photo", "Add a photo")}
            </Button>
            {form.imageUrl ? (
              <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, imageUrl: null })}>
                <Trash2 className="size-4" />
                {tr(fr, "Retirer", "Remove")}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>
        <Labeled label={tr(fr, "Nom affiché", "Display name")}>
          <input className={field} maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Labeled>
        <Labeled label={tr(fr, "Description", "Description")}>
          <textarea className={`${field} h-auto py-2`} rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Labeled>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label={tr(fr, "Catégorie", "Category")}>
            <select className={field} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">{tr(fr, "— Sans catégorie —", "— None —")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nameFr}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label={tr(fr, `Prix par ${product.unit} (${product.currency})`, `Price per ${product.unit} (${product.currency})`)}>
            <input className={field} inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value.replace(",", ".") })} />
          </Labeled>
          <Labeled label={tr(fr, "Nom de l’unité pour le client", "Unit name for customers")}>
            <input className={field} maxLength={60} placeholder={product.unit} value={form.unitLabel} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} />
          </Labeled>
          <Labeled label={tr(fr, "Vendu par paquets de", "Sold in packs of")}>
            <input className={field} inputMode="decimal" value={form.quantityStep} onChange={(event) => setForm({ ...form, quantityStep: event.target.value })} />
          </Labeled>
          <Labeled label={tr(fr, "Quantité minimum", "Minimum quantity")}>
            <input className={field} inputMode="decimal" value={form.minimumQuantity} onChange={(event) => setForm({ ...form, minimumQuantity: event.target.value })} />
          </Labeled>
          <Labeled label={tr(fr, "Ordre d’affichage", "Display order")}>
            <input className={field} inputMode="numeric" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
          </Labeled>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm({ ...form, isAvailable: event.target.checked })} />
          {tr(fr, "Disponible à la vente (décochez pour afficher « Épuisé »)", "Available for sale (untick to show “sold out”)")}
        </label>
        <p className="text-xs text-ink-muted">
          {tr(
            fr,
            "Exemple œufs : prix par œuf 500, paquets de 30, unité « œuf » → le client commande par plateau de 30.",
            "Example eggs: price per egg 500, packs of 30 → customers order by trays of 30.",
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr(fr, "Annuler", "Cancel")}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {tr(fr, "Enregistrer", "Save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function Orders({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const orders = useQuery({
    queryKey: ["shop-orders", orgSlug, filter],
    queryFn: () => get<{ orders: Order[] }>(orgUrl(orgSlug, "shop/orders"), { params: { filter } }),
    refetchInterval: 20_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shop-orders", orgSlug] });
    void queryClient.invalidateQueries({ queryKey: ["shop", orgSlug] });
  };
  const confirm = useMutation({
    mutationFn: (id: string) => post(orgUrl(orgSlug, `sales/orders/${id}/confirm`), {}),
    onSuccess: () => {
      toast.success(tr(fr, "Commande confirmée. Livraison et facture se font dans Ventes.", "Order confirmed. Delivery and invoice are in Sales."));
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: (input: { id: string; reason: string }) => post(orgUrl(orgSlug, `shop/orders/${input.id}/cancel`), { reason: input.reason }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(["todo", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`h-8 rounded-full border px-3 text-xs font-semibold ${filter === key ? "border-brand bg-brand/10 text-brand" : "border-border text-ink-secondary"}`}
          >
            {key === "todo" ? tr(fr, "À confirmer", "To confirm") : tr(fr, "Toutes", "All")}
          </button>
        ))}
      </div>
      {orders.isLoading ? (
        <SkeletonCard rows={4} />
      ) : !orders.data?.orders.length ? (
        <EmptyState icon={ShoppingBag} title={filter === "todo" ? tr(fr, "Aucune commande à confirmer", "Nothing to confirm") : tr(fr, "Aucune commande web", "No web orders")} />
      ) : (
        orders.data.orders.map((order) => (
          <article key={order.id} className={`rounded-2xl border bg-surface-1 p-4 ${order.status === "draft" ? "border-brand/40" : "border-border"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink">{order.number}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${order.status === "draft" ? "bg-critical/10 text-critical" : order.status === "cancelled" ? "bg-surface-2 text-ink-muted" : "bg-good/15 text-good"}`}>
                {(STATUS[order.status] ?? [order.status, order.status])[fr ? 0 : 1]}
              </span>
              <span className="text-xs text-ink-muted">{new Date(order.createdAt).toLocaleString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="ml-auto text-lg font-bold text-ink">{money(order.total, order.currency)}</span>
            </div>
            <p className="mt-1 text-sm text-ink">
              {order.contact.name} ·{" "}
              <a className="font-semibold text-brand" href={`tel:${order.contact.phone ?? ""}`}>
                {order.contact.phone}
              </a>
              {order.contact.phone ? (
                <>
                  {" · "}
                  <a className="text-brand" target="_blank" rel="noreferrer" href={`https://wa.me/${(order.contact.phone ?? "").replace(/\D/g, "")}`}>
                    WhatsApp
                  </a>
                </>
              ) : null}
              {order.contact.email ? ` · ${order.contact.email}` : ""}
            </p>
            <p className="text-sm text-ink-secondary">
              {order.deliveryMode === "delivery" ? `${tr(fr, "Livraison", "Delivery")} : ${order.deliveryAddress ?? "—"}` : tr(fr, "Retrait sur place", "Pick-up")}
            </p>
            {order.note ? <p className="mt-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-ink">« {order.note} »</p> : null}
            <ul className="mt-2 text-sm text-ink">
              {order.lines.map((line, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>
                    {line.description} × {line.quantity.toLocaleString("fr-FR")} {line.unit}
                  </span>
                  <span>{money(line.total, order.currency)}</span>
                </li>
              ))}
            </ul>
            {order.cancelledReason ? <p className="mt-1 text-xs text-ink-muted">{order.cancelledReason}</p> : null}
            {order.status === "draft" ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate(order.id)}>
                  {tr(fr, "Confirmer la commande", "Confirm order")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={cancel.isPending}
                  onClick={() => {
                    const reason = window.prompt(tr(fr, "Raison de l’annulation (visible par le client) :", "Cancellation reason:"), "");
                    if (reason !== null) cancel.mutate({ id: order.id, reason });
                  }}
                >
                  <X className="size-4" />
                  {tr(fr, "Annuler", "Cancel")}
                </Button>
              </div>
            ) : (
              <Link href={`/${orgSlug}/sales`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                {tr(fr, "Livraison, facture et paiement dans Ventes →", "Delivery, invoice and payment in Sales →")}
              </Link>
            )}
          </article>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Categories({ orgSlug, fr, categories }: { orgSlug: string; fr: boolean; categories: Category[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const done = (data: Overview) => queryClient.setQueryData(["shop", orgSlug], data);
  const create = useMutation({
    mutationFn: () => post<Overview>(orgUrl(orgSlug, "shop/categories"), { nameFr: name, sortOrder: categories.length }),
    onSuccess: (data) => {
      done(data);
      setName("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = useMutation({
    mutationFn: (category: Category) =>
      put<Overview>(orgUrl(orgSlug, `shop/categories/${category.id}`), {
        nameFr: category.nameFr,
        nameEn: category.nameEn,
        sortOrder: category.sortOrder,
        isVisible: category.isVisible,
      }),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del<Overview>(orgUrl(orgSlug, `shop/categories/${id}`)),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={tr(fr, "Nouvelle catégorie (ex. Œufs, Volailles, Porc)", "New category (e.g. Eggs, Poultry, Pork)")}
          className="h-10 flex-1 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
        />
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          <Plus className="size-4" />
          {tr(fr, "Ajouter", "Add")}
        </Button>
      </form>
      {!categories.length ? (
        <p className="text-sm text-ink-secondary">{tr(fr, "Aucune catégorie : tous les produits s’affichent ensemble.", "No categories: all products are shown together.")}</p>
      ) : (
        <div className="divide-y divide-border rounded-2xl border border-border bg-surface-1">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-2 p-3">
              <input
                defaultValue={category.nameFr}
                maxLength={80}
                onBlur={(event) => event.target.value.trim() && event.target.value !== category.nameFr && update.mutate({ ...category, nameFr: event.target.value.trim() })}
                className="h-9 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm text-ink hover:border-border focus:border-border-strong"
              />
              <input
                type="number"
                defaultValue={category.sortOrder}
                min={0}
                title={tr(fr, "Ordre", "Order")}
                onBlur={(event) => Number(event.target.value) !== category.sortOrder && update.mutate({ ...category, sortOrder: Number(event.target.value) || 0 })}
                className="h-9 w-16 rounded-lg border border-border bg-surface-1 px-2 text-sm text-ink"
              />
              <Button size="sm" variant="ghost" onClick={() => update.mutate({ ...category, isVisible: !category.isVisible })}>
                {category.isVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.confirm(tr(fr, `Supprimer « ${category.nameFr} » ?`, `Delete “${category.nameFr}”?`)) && remove.mutate(category.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ orgSlug, fr, settings }: { orgSlug: string; fr: boolean; settings: Settings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(settings);
  const save = useMutation({
    mutationFn: () => put<Overview>(orgUrl(orgSlug, "shop/settings"), form),
    onSuccess: (data) => {
      queryClient.setQueryData(["shop", orgSlug], data);
      toast.success(tr(fr, "Réglages enregistrés.", "Settings saved."));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const area = "w-full rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink";
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
      <label className="flex items-start gap-2 rounded-xl border border-border p-3">
        <input type="checkbox" className="mt-1" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
        <span>
          <span className="block font-medium text-ink">{tr(fr, "Boutique ouverte", "Shop open")}</span>
          <span className="block text-xs text-ink-secondary">
            {tr(
              fr,
              "Les produits « Sur le site » s’affichent dans le bloc Boutique du site (Site web → ajoutez une page « Boutique » ou le bloc « Boutique (produits) »).",
              "Products marked “On website” appear in the website Shop block (Website → add a “Shop” page or the “Shop (products)” block).",
            )}
          </span>
        </span>
      </label>
      <div className="flex flex-wrap gap-4 text-sm text-ink">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.deliveryEnabled} onChange={(event) => setForm({ ...form, deliveryEnabled: event.target.checked })} />
          {tr(fr, "Livraison", "Delivery")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.pickupEnabled} onChange={(event) => setForm({ ...form, pickupEnabled: event.target.checked })} />
          {tr(fr, "Retrait sur place", "Pick-up")}
        </label>
      </div>
      <Labeled label={tr(fr, "Infos livraison (zones, délais, frais)", "Delivery info (areas, timing, fees)")}>
        <textarea className={area} rows={2} maxLength={1000} value={form.deliveryNote ?? ""} onChange={(event) => setForm({ ...form, deliveryNote: event.target.value })} />
      </Labeled>
      <Labeled label={tr(fr, "Infos paiement", "Payment info")}>
        <textarea className={area} rows={2} maxLength={1000} placeholder={tr(fr, "Ex. : paiement à la livraison ou M-Pesa / Orange Money après confirmation.", "E.g. pay on delivery or mobile money after confirmation.")} value={form.paymentNote ?? ""} onChange={(event) => setForm({ ...form, paymentNote: event.target.value })} />
      </Labeled>
      <Labeled label={tr(fr, "Autre message affiché à la commande", "Other message shown at checkout")}>
        <textarea className={area} rows={2} maxLength={1000} value={form.orderNote ?? ""} onChange={(event) => setForm({ ...form, orderNote: event.target.value })} />
      </Labeled>
      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {tr(fr, "Enregistrer", "Save")}
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-ink-secondary">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl sm:max-h-[90dvh] sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-secondary hover:bg-surface-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
