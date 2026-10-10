"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/ui/states";
import { get, orgUrl, put } from "@/lib/api";

type Instructions = { shared: string; mail: string; website: string };
type FieldKey = keyof Instructions;

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);

/** Ready-made sentences: one click adds them, then the text can be edited. */
const SUGGESTIONS: { label: [string, string]; text: [string, string] }[] = [
  {
    label: ["Recrutement fermé", "Not hiring"],
    text: [
      "Nous ne recrutons pas pour le moment. Les candidatures déjà reçues sont en cours de traitement. Les nouvelles offres seront publiées sur notre page Carrières.",
      "We are not hiring at the moment. Applications already received are being reviewed. New openings will be posted on our Careers page.",
    ],
  },
  {
    label: ["Commandes", "Orders"],
    text: [
      "Pour commander : demander le nom, le téléphone, le produit, la quantité et le lieu de livraison. L’équipe confirme ensuite le prix, la disponibilité et le délai.",
      "To order: ask for name, phone, product, quantity and delivery place. The team then confirms price, availability and timing.",
    ],
  },
  {
    label: ["Horaires", "Opening hours"],
    text: ["Horaires : du lundi au samedi, de [8h] à [17h].", "Opening hours: Monday to Saturday, [8am] to [5pm]."],
  },
  {
    label: ["Livraison", "Delivery"],
    text: ["Livraison : [zones desservies] sous [délai]. Frais : [montant ou « sur devis »].", "Delivery: [areas] within [time]. Fee: [amount or “on quote”]."],
  },
  {
    label: ["Paiement", "Payment"],
    text: ["Moyens de paiement acceptés : [espèces, mobile money, virement].", "Accepted payment: [cash, mobile money, bank transfer]."],
  },
  {
    label: ["Ton", "Tone"],
    text: [
      "Toujours vouvoyer, rester bref, chaleureux et professionnel. Ne jamais promettre un prix ou une date sans confirmation de l’équipe.",
      "Always be brief, warm and professional. Never promise a price or date without the team's confirmation.",
    ],
  },
];

/** Instructions the AI follows on the website chat and in e-mail drafts. */
export function AiInstructionsDialog({
  orgSlug,
  fr,
  onClose,
  focus = "shared",
}: {
  orgSlug: string;
  fr: boolean;
  onClose: () => void;
  focus?: FieldKey;
}) {
  const query = useQuery({
    queryKey: ["ai-instructions", orgSlug],
    queryFn: () => get<Instructions>(orgUrl(orgSlug, "ai-instructions")),
  });
  const [values, setValues] = useState<Instructions | null>(null);
  const [target, setTarget] = useState<FieldKey>(focus);
  useEffect(() => {
    if (query.data) setValues(query.data);
  }, [query.data]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => put<Instructions>(orgUrl(orgSlug, "ai-instructions"), values ?? {}),
    onSuccess: () => {
      toast.success(tr(fr, "Consignes enregistrées. L’IA les utilise dès maintenant.", "Instructions saved. The AI uses them right away."));
      onClose();
    },
    onError: (error) =>
      toast.error(
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          (error instanceof Error ? error.message : ""),
      ),
  });

  const add = (text: string) =>
    setValues((current) => {
      if (!current) return current;
      const existing = current[target].trim();
      if (existing.includes(text)) return current;
      return { ...current, [target]: existing ? `${existing}\n${text}` : text };
    });

  const fields: { key: FieldKey; title: string; hint: string; max: number }[] = [
    {
      key: "shared",
      title: tr(fr, "Consignes générales · site et e-mails", "General instructions · website and e-mails"),
      hint: tr(fr, "Ce que l’IA doit toujours savoir. Ex. : « Nous ne recrutons pas pour le moment ».", "What the AI must always know. E.g. “We are not hiring right now”."),
      max: 8000,
    },
    {
      key: "mail",
      title: tr(fr, "Seulement pour les réponses e-mail", "E-mail replies only"),
      hint: tr(fr, "Ex. : qui contacter pour les factures, documents à demander aux candidats…", "E.g. who handles invoices, documents to request from applicants…"),
      max: 8000,
    },
    {
      key: "website",
      title: tr(fr, "Seulement pour le chat du site", "Website chat only"),
      hint: tr(fr, "Ex. : produits, adresse des fermes, visites, conditions de commande…", "E.g. products, farm addresses, visits, order conditions…"),
      max: 6000,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <Sparkles className="size-4 text-brand" />
            {tr(fr, "Consignes pour l’IA", "AI instructions")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-secondary hover:bg-surface-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
          <p className="text-xs leading-5 text-ink-secondary">
            {tr(
              fr,
              "L’IA lit ces consignes avant chaque réponse (chat du site et brouillons d’e-mails). Elles passent avant le contenu du site. Ajoutez une phrase toute prête puis complétez les [crochets].",
              "The AI reads these instructions before every reply (website chat and e-mail drafts). They take priority over the website content. Add a ready-made sentence, then fill in the [brackets].",
            )}
          </p>
          {!values ? (
            <SkeletonCard rows={5} />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item.label[0]}
                    type="button"
                    onClick={() => add(fr ? item.text[0] : item.text[1])}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand"
                  >
                    <Plus className="size-3" />
                    {fr ? item.label[0] : item.label[1]}
                  </button>
                ))}
              </div>
              {fields.map((field) => (
                <label key={field.key} className={`block rounded-xl border p-3 ${target === field.key ? "border-brand" : "border-border"}`}>
                  <span className="block text-sm font-medium text-ink">{field.title}</span>
                  <span className="block text-xs text-ink-secondary">{field.hint}</span>
                  <textarea
                    value={values[field.key]}
                    maxLength={field.max}
                    rows={field.key === "shared" ? 5 : 3}
                    onFocus={() => setTarget(field.key)}
                    onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                    className="mt-2 w-full rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
                  />
                  {target === field.key ? (
                    <span className="mt-1 block text-[11px] text-ink-muted">
                      {tr(fr, "Les phrases toutes prêtes s’ajoutent ici.", "Ready-made sentences are added here.")}
                    </span>
                  ) : null}
                </label>
              ))}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {tr(fr, "Annuler", "Cancel")}
            </Button>
            <Button loading={save.isPending} disabled={!values} onClick={() => save.mutate()}>
              {tr(fr, "Enregistrer", "Save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
