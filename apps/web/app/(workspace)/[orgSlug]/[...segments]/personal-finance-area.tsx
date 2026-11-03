"use client";

/**
 * "Mes finances" — the workspace owner's personal money: income, expenses,
 * budgets per category, debts and credits, recurring payments, in USD and FC.
 * Private: the API serves only the signed-in owner's own rows.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  LockKeyhole,
  Pause,
  Play,
  PiggyBank,
  Plus,
  Repeat,
  Settings2,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/input";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { del, get, orgUrl, patch, post, put } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";

type Currency = "USD" | "CDF";
type Kind = "income" | "expense" | "debt_payment";
type Category = { id: string; kind: "income" | "expense"; name: string; color: string | null; monthlyBudget: number | null; budgetCurrency: Currency };
type Debt = {
  id: string;
  direction: "i_owe" | "owed_to_me";
  name: string;
  counterparty: string | null;
  amount: number;
  currency: Currency;
  paid: number;
  remaining: number;
  percent: number;
  dueOn: string | null;
  lastPaymentOn: string | null;
  closed: boolean;
};
type Recurring = {
  id: string;
  kind: Kind;
  label: string;
  amount: number;
  currency: Currency;
  categoryName: string | null;
  debtName: string | null;
  dayOfMonth: number;
  active: boolean;
  doneThisMonth: boolean;
};
type Transaction = {
  id: string;
  kind: Kind;
  amount: number;
  currency: Currency;
  amountUsd: number;
  categoryName: string | null;
  categoryColor: string | null;
  debtName: string | null;
  recurringLabel: string | null;
  occurredOn: string;
  note: string | null;
};
type Summary = {
  month: string;
  settings: { cdfPerUsd: number; displayCurrency: Currency };
  totals: {
    incomeUsd: number;
    expenseUsd: number;
    debtPaidUsd: number;
    debtReceivedUsd: number;
    inUsd: number;
    outUsd: number;
    remainingUsd: number;
    spentPercent: number | null;
  };
  budgets: { categoryId: string; name: string; color: string | null; spentUsd: number; budgetUsd: number | null; percent: number | null }[];
  debts: Debt[];
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  history: { month: string; inUsd: number; outUsd: number }[];
};

const tr = (fr: boolean, french: string, english: string) => (fr ? french : english);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const todayIso = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, index! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function money(value: number, currency: Currency) {
  if (currency === "CDF")
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} FC`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function PersonalFinanceArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth);
  const key = ["personal-finance", orgSlug, month];
  const base = orgUrl(orgSlug, "personal-finance");
  const data = useQuery({ queryKey: key, queryFn: () => get<Summary>(`${base}?month=${month}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["personal-finance", orgSlug] });
  const [prefill, setPrefill] = useState<{ kind: Kind; debtId?: string } | null>(null);

  if (data.isLoading)
    return (
      <div className="mx-auto max-w-6xl p-4">
        <SkeletonCard rows={6} />
      </div>
    );
  if (data.isError || !data.data)
    return (
      <div className="mx-auto max-w-6xl p-4">
        <ErrorState title={tr(fr, "Finances indisponibles", "Finances unavailable")} description={errorMessage(data.error)} onRetry={() => void data.refetch()} />
      </div>
    );

  const summary = data.data;
  const display = summary.settings.displayCurrency;
  const rate = summary.settings.cdfPerUsd;
  const show = (usd: number) => money(display === "USD" ? usd : usd * rate, display);
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(fr ? "fr-FR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--brand),#16a34a)] text-white shadow-sm">
          <Wallet className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-ink">{tr(fr, "Mes finances", "My finances")}</h1>
          <p className="flex items-center gap-1 text-xs text-ink-secondary">
            <LockKeyhole className="size-3.5" />
            {tr(fr, "Privé : visible seulement par vous.", "Private: only you can see this.")}
          </p>
        </div>
        <div className="order-last flex w-full items-center justify-between gap-1 rounded-xl border border-border bg-surface-1 p-1 sm:order-none sm:w-auto">
          <button type="button" className="rounded-lg p-1.5 text-ink-secondary hover:bg-surface-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={tr(fr, "Mois précédent", "Previous month")}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-32 text-center text-sm font-semibold capitalize text-ink">{monthLabel}</span>
          <button type="button" className="rounded-lg p-1.5 text-ink-secondary hover:bg-surface-2 disabled:opacity-40" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))} aria-label={tr(fr, "Mois suivant", "Next month")}>
            <ChevronRight className="size-4" />
          </button>
        </div>
        <SettingsButton fr={fr} base={base} settings={summary.settings} onSaved={refresh} />
      </header>

      <Totals fr={fr} summary={summary} show={show} />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-4">
          <QuickAdd fr={fr} base={base} summary={summary} prefill={prefill} onDone={() => { setPrefill(null); void refresh(); }} />
          <Budgets fr={fr} base={base} summary={summary} show={show} onSaved={refresh} />
          <Transactions fr={fr} base={base} summary={summary} onSaved={refresh} />
        </div>
        <div className="space-y-4">
          <Recurrings fr={fr} base={base} summary={summary} month={month} onSaved={refresh} />
          <Debts fr={fr} base={base} summary={summary} onSaved={refresh} onPay={(debt) => setPrefill({ kind: "debt_payment", debtId: debt.id })} />
          <Trend fr={fr} summary={summary} show={show} />
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function Panel({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,.6)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-brand">{icon}</span>
        <h2 className="flex-1 text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-border-strong bg-surface-1 px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ring";

function Totals({ fr, summary, show }: { fr: boolean; summary: Summary; show: (usd: number) => string }) {
  const { totals } = summary;
  const remainingGood = totals.remainingUsd >= 0;
  const percent = Math.min(100, totals.spentPercent ?? (totals.outUsd > 0 ? 100 : 0));
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <ArrowDownCircle className="size-4 text-good" />
          {tr(fr, "Entrées", "Money in")}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{show(totals.inUsd)}</p>
        {totals.debtReceivedUsd > 0 ? (
          <p className="text-xs text-ink-secondary">{tr(fr, "dont remboursements reçus", "incl. repayments received")} {show(totals.debtReceivedUsd)}</p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <ArrowUpCircle className="size-4 text-critical" />
          {tr(fr, "Sorties", "Money out")}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{show(totals.outUsd)}</p>
        <p className="text-xs text-ink-secondary">
          {tr(fr, "Dépenses", "Expenses")} {show(totals.expenseUsd)} · {tr(fr, "Dettes", "Debts")} {show(totals.debtPaidUsd)}
        </p>
      </div>
      <div className={`rounded-2xl border p-4 ${remainingGood ? "border-good/30 bg-good/[.06]" : "border-critical/30 bg-critical/[.06]"}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{tr(fr, "Il reste", "Left")}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${remainingGood ? "text-good" : "text-critical"}`}>{show(totals.remainingUsd)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={`h-full rounded-full ${percent >= 90 ? "bg-critical" : percent >= 70 ? "bg-warning" : "bg-good"}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-secondary">
          {totals.spentPercent === null
            ? tr(fr, "Ajoutez vos revenus du mois.", "Add this month's income.")
            : tr(fr, `${totals.spentPercent} % de vos entrées déjà dépensés`, `${totals.spentPercent}% of your income already spent`)}
        </p>
      </div>
    </section>
  );
}

function QuickAdd({
  fr,
  base,
  summary,
  prefill,
  onDone,
}: {
  fr: boolean;
  base: string;
  summary: Summary;
  prefill: { kind: Kind; debtId?: string } | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind>("expense");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(summary.settings.displayCurrency);
  const [categoryId, setCategoryId] = useState("");
  const [debtId, setDebtId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState<typeof prefill>(null);
  if (prefill && prefill !== seen) {
    setSeen(prefill);
    setKind(prefill.kind);
    setDebtId(prefill.debtId ?? "");
  }
  const categories = summary.categories.filter((category) => category.kind === (kind === "income" ? "income" : "expense"));
  const openDebts = summary.debts.filter((debt) => !debt.closed);
  const save = useMutation({
    mutationFn: () =>
      post(`${base}/transactions`, {
        kind,
        amount: Number(amount.replace(",", ".")),
        currency,
        categoryId: kind === "debt_payment" ? null : categoryId || null,
        debtId: kind === "debt_payment" ? debtId || null : null,
        occurredOn: date,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(tr(fr, "Enregistré.", "Saved."));
      setAmount("");
      setNote("");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!(Number(amount.replace(",", ".")) > 0)) return toast.error(tr(fr, "Entrez un montant.", "Enter an amount."));
    if (kind === "debt_payment" && !debtId) return toast.error(tr(fr, "Choisissez la dette.", "Choose the debt."));
    save.mutate();
  };
  const tabs: { value: Kind; label: string }[] = [
    { value: "expense", label: tr(fr, "Dépense", "Expense") },
    { value: "income", label: tr(fr, "Revenu", "Income") },
    { value: "debt_payment", label: tr(fr, "Dette / crédit", "Debt / credit") },
  ];
  return (
    <Panel title={tr(fr, "Ajouter", "Add")} icon={<Plus className="size-4" />}>
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setKind(tab.value);
                setCategoryId("");
              }}
              className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${kind === tab.value ? "bg-surface-1 text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr(fr, "Montant", "Amount")} required>
            <Input inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Devise", "Currency")}>
            <select className={selectClass} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
              <option value="USD">$ USD</option>
              <option value="CDF">FC</option>
            </select>
          </Field>
        </div>
        {kind === "debt_payment" ? (
          <Field label={tr(fr, "Dette ou crédit", "Debt or credit")} required hint={openDebts.length ? undefined : tr(fr, "Ajoutez d’abord une dette à droite.", "Add a debt first.")}>
            <select className={selectClass} value={debtId} onChange={(event) => setDebtId(event.target.value)}>
              <option value="">{tr(fr, "Choisir…", "Choose…")}</option>
              {openDebts.map((debt) => (
                <option key={debt.id} value={debt.id}>
                  {debt.direction === "owed_to_me" ? tr(fr, "Reçu de · ", "Received · ") : ""}
                  {debt.name} — {tr(fr, "reste", "left")} {money(debt.remaining, debt.currency)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={tr(fr, "Catégorie", "Category")}>
            <select className={selectClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{tr(fr, "Choisir…", "Choose…")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label={tr(fr, "Date", "Date")}>
            <Input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label={tr(fr, "Note", "Note")}>
            <Input placeholder={tr(fr, "Ex. plein d’essence", "e.g. fuel")} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <Button type="submit" className="w-full" loading={save.isPending}>
          <Check className="size-4" />
          {tr(fr, "Enregistrer", "Save")}
        </Button>
      </form>
    </Panel>
  );
}

function Budgets({ fr, base, summary, show, onSaved }: { fr: boolean; base: string; summary: Summary; show: (usd: number) => string; onSaved: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const expenseCategories = summary.categories.filter((category) => category.kind === "expense");
  const saveBudget = useMutation({
    mutationFn: (input: { id: string; budget: number | null }) =>
      patch(`${base}/categories/${input.id}`, { monthlyBudget: input.budget, budgetCurrency: summary.settings.displayCurrency }),
    onSuccess: () => {
      setEditing(null);
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const addCategory = useMutation({
    mutationFn: () => post(`${base}/categories`, { kind: "expense", name: name.trim() }),
    onSuccess: () => {
      setName("");
      setAdding(false);
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const withoutBudget = expenseCategories.filter((category) => !summary.budgets.some((budget) => budget.categoryId === category.id));
  return (
    <Panel
      title={tr(fr, "Budget par catégorie", "Budget by category")}
      icon={<PiggyBank className="size-4" />}
      action={
        <button type="button" className="text-xs font-semibold text-brand" onClick={() => setAdding((open) => !open)}>
          {adding ? tr(fr, "Fermer", "Close") : tr(fr, "+ Catégorie", "+ Category")}
        </button>
      }
    >
      {adding ? (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) addCategory.mutate();
          }}
        >
          <Input placeholder={tr(fr, "Nom de la catégorie", "Category name")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" size="sm" loading={addCategory.isPending}>
            {tr(fr, "Ajouter", "Add")}
          </Button>
        </form>
      ) : null}
      {summary.budgets.length === 0 ? (
        <p className="text-sm text-ink-secondary">{tr(fr, "Aucune dépense ce mois-ci.", "No spending this month.")}</p>
      ) : (
        <ul className="space-y-3">
          {summary.budgets.map((budget) => {
            const over = budget.percent !== null && budget.percent > 100;
            const width = budget.percent === null ? 100 : Math.min(100, budget.percent);
            return (
              <li key={budget.categoryId}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ background: budget.color ?? "#94a3b8" }} />
                  <span className="flex-1 truncate font-medium text-ink">{budget.name}</span>
                  <span className="tabular-nums text-ink">{show(budget.spentUsd)}</span>
                  {budget.categoryId !== "none" ? (
                    editing === budget.categoryId ? null : (
                      <button
                        type="button"
                        className="text-xs text-ink-muted hover:text-brand"
                        onClick={() => {
                          setEditing(budget.categoryId);
                          setValue(budget.budgetUsd === null ? "" : String(Math.round(summary.settings.displayCurrency === "USD" ? budget.budgetUsd : budget.budgetUsd * summary.settings.cdfPerUsd)));
                        }}
                      >
                        / {budget.budgetUsd === null ? tr(fr, "budget ?", "budget?") : show(budget.budgetUsd)}
                      </button>
                    )
                  ) : null}
                </div>
                {editing === budget.categoryId ? (
                  <BudgetEditor fr={fr} value={value} setValue={setValue} currency={summary.settings.displayCurrency} pending={saveBudget.isPending} onCancel={() => setEditing(null)} onSave={(amount) => saveBudget.mutate({ id: budget.categoryId, budget: amount })} />
                ) : null}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full ${budget.percent === null ? "bg-ink-muted/40" : over ? "bg-critical" : budget.percent >= 80 ? "bg-warning" : "bg-good"}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                {over ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-critical">
                    {tr(fr, `Budget dépassé de ${show(budget.spentUsd - (budget.budgetUsd ?? 0))}`, `Over budget by ${show(budget.spentUsd - (budget.budgetUsd ?? 0))}`)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {withoutBudget.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">{tr(fr, "Fixer un budget pour une autre catégorie", "Set a budget for another category")}</summary>
          <ul className="mt-2 space-y-1">
            {withoutBudget.map((category) => (
              <li key={category.id} className="flex items-center gap-2">
                <span className="flex-1 text-ink">{category.name}</span>
                {editing === category.id ? (
                  <BudgetEditor fr={fr} value={value} setValue={setValue} currency={summary.settings.displayCurrency} pending={saveBudget.isPending} onCancel={() => setEditing(null)} onSave={(amount) => saveBudget.mutate({ id: category.id, budget: amount })} />
                ) : (
                  <button type="button" className="text-xs font-semibold text-brand" onClick={() => { setEditing(category.id); setValue(""); }}>
                    {tr(fr, "Budget", "Budget")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

function BudgetEditor({
  fr,
  value,
  setValue,
  currency,
  pending,
  onCancel,
  onSave,
}: {
  fr: boolean;
  value: string;
  setValue: (value: string) => void;
  currency: Currency;
  pending: boolean;
  onCancel: () => void;
  onSave: (amount: number | null) => void;
}) {
  return (
    <form
      className="mt-1 flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const amount = Number(value.replace(",", "."));
        onSave(value.trim() === "" ? null : amount >= 0 ? amount : null);
      }}
    >
      <Input autoFocus inputMode="decimal" className="h-8" placeholder={tr(fr, "Budget par mois", "Monthly budget")} value={value} onChange={(event) => setValue(event.target.value)} />
      <span className="text-xs text-ink-muted">{currency === "USD" ? "$" : "FC"}</span>
      <Button type="submit" size="sm" loading={pending}>
        <Check className="size-4" />
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        <X className="size-4" />
      </Button>
    </form>
  );
}

function Transactions({ fr, base, summary, onSaved }: { fr: boolean; base: string; summary: Summary; onSaved: () => void }) {
  const remove = useMutation({
    mutationFn: (id: string) => del(`${base}/transactions/${id}`),
    onSuccess: onSaved,
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Panel title={tr(fr, "Mouvements du mois", "This month's entries")} icon={<CalendarClock className="size-4" />}>
      {summary.transactions.length === 0 ? (
        <p className="text-sm text-ink-secondary">{tr(fr, "Rien d’enregistré pour ce mois.", "Nothing recorded this month.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {summary.transactions.map((row) => {
            const incoming = row.kind === "income";
            const label = row.kind === "debt_payment" ? `${tr(fr, "Dette", "Debt")} · ${row.debtName ?? ""}` : (row.categoryName ?? tr(fr, "Sans catégorie", "Uncategorised"));
            return (
              <li key={row.id} className="group flex items-center gap-3 py-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.kind === "debt_payment" ? "#f59e0b" : (row.categoryColor ?? "#94a3b8") }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{label}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {new Date(`${row.occurredOn}T00:00:00Z`).toLocaleDateString(fr ? "fr-FR" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" })}
                    {row.note ? ` · ${row.note}` : ""}
                    {row.recurringLabel ? ` · ${tr(fr, "récurrent", "recurring")}` : ""}
                  </p>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${incoming ? "text-good" : "text-ink"}`}>
                  {incoming ? "+" : "−"}
                  {money(row.amount, row.currency)}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-ink-muted opacity-60 hover:text-critical hover:opacity-100"
                  aria-label={tr(fr, "Supprimer", "Delete")}
                  onClick={async () => {
                    if (await confirmDialog({ title: tr(fr, "Supprimer ce mouvement ?", "Delete this entry?"), tone: "danger", confirmLabel: tr(fr, "Supprimer", "Delete") }))
                      remove.mutate(row.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Debts({ fr, base, summary, onSaved, onPay }: { fr: boolean; base: string; summary: Summary; onSaved: () => void; onPay: (debt: Debt) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ direction: "i_owe" as Debt["direction"], name: "", counterparty: "", amount: "", currency: summary.settings.displayCurrency as Currency, dueOn: "" });
  const create = useMutation({
    mutationFn: () =>
      post(`${base}/debts`, {
        direction: form.direction,
        name: form.name.trim(),
        counterparty: form.counterparty.trim() || null,
        amount: Number(form.amount.replace(",", ".")),
        currency: form.currency,
        dueOn: form.dueOn || null,
      }),
    onSuccess: () => {
      setOpen(false);
      setForm((current) => ({ ...current, name: "", counterparty: "", amount: "", dueOn: "" }));
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`${base}/debts/${id}`),
    onSuccess: onSaved,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const totalOwed = summary.debts
    .filter((debt) => debt.direction === "i_owe" && !debt.closed)
    .reduce((sum, debt) => sum + (debt.currency === "USD" ? debt.remaining : debt.remaining / summary.settings.cdfPerUsd), 0);
  return (
    <Panel
      title={tr(fr, "Dettes et crédits", "Debts and credits")}
      icon={<HandCoins className="size-4" />}
      action={
        <button type="button" className="text-xs font-semibold text-brand" onClick={() => setOpen((value) => !value)}>
          {open ? tr(fr, "Fermer", "Close") : tr(fr, "+ Dette", "+ Debt")}
        </button>
      }
    >
      {totalOwed > 0 ? (
        <p className="mb-3 rounded-xl bg-warning/[.08] px-3 py-2 text-sm text-ink">
          {tr(fr, "Il vous reste à rembourser", "You still owe")} <b className="tabular-nums">{money(totalOwed, "USD")}</b>
        </p>
      ) : null}
      {open ? (
        <form
          className="mb-3 space-y-2 rounded-xl border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.name.trim() || !(Number(form.amount.replace(",", ".")) > 0)) return toast.error(tr(fr, "Nom et montant requis.", "Name and amount required."));
            create.mutate();
          }}
        >
          <select className={selectClass} value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as Debt["direction"] })}>
            <option value="i_owe">{tr(fr, "Je dois (dette, crédit)", "I owe (debt, credit)")}</option>
            <option value="owed_to_me">{tr(fr, "On me doit", "Owed to me")}</option>
          </select>
          <Input placeholder={tr(fr, "Nom (ex. Crédit voiture)", "Name (e.g. Car loan)")} value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input placeholder={tr(fr, "Banque ou personne (facultatif)", "Bank or person (optional)")} value={form.counterparty} maxLength={120} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input inputMode="decimal" placeholder={tr(fr, "Montant total", "Total amount")} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            <select className={selectClass} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as Currency })}>
              <option value="USD">$ USD</option>
              <option value="CDF">FC</option>
            </select>
          </div>
          <Field label={tr(fr, "À rembourser avant (facultatif)", "Due by (optional)")}>
            <Input type="date" value={form.dueOn} onChange={(event) => setForm({ ...form, dueOn: event.target.value })} />
          </Field>
          <Button type="submit" size="sm" className="w-full" loading={create.isPending}>
            {tr(fr, "Ajouter la dette", "Add debt")}
          </Button>
        </form>
      ) : null}
      {summary.debts.length === 0 ? (
        <p className="text-sm text-ink-secondary">{tr(fr, "Aucune dette enregistrée.", "No debts recorded.")}</p>
      ) : (
        <ul className="space-y-3">
          {summary.debts.map((debt) => (
            <li key={debt.id} className={`rounded-xl border border-border p-3 ${debt.closed ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {debt.name}
                    {debt.direction === "owed_to_me" ? <span className="ml-1.5 rounded bg-good/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-good">{tr(fr, "On me doit", "Owed to me")}</span> : null}
                    {debt.closed ? <span className="ml-1.5 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-secondary">{tr(fr, "Soldée", "Paid off")}</span> : null}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {debt.counterparty ? `${debt.counterparty} · ` : ""}
                    {tr(fr, "Total", "Total")} {money(debt.amount, debt.currency)}
                    {debt.dueOn ? ` · ${tr(fr, "avant le", "due")} ${new Date(`${debt.dueOn}T00:00:00Z`).toLocaleDateString(fr ? "fr-FR" : "en-US", { timeZone: "UTC" })}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-ink-muted hover:text-critical"
                  aria-label={tr(fr, "Supprimer", "Delete")}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: tr(fr, "Supprimer cette dette ?", "Delete this debt?"),
                        message: tr(fr, "Ses remboursements enregistrés seront aussi supprimés.", "Its recorded payments will be deleted too."),
                        tone: "danger",
                        confirmLabel: tr(fr, "Supprimer", "Delete"),
                      })
                    )
                      remove.mutate(debt.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-good" style={{ width: `${debt.percent}%` }} />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs">
                <span className="text-ink-secondary">
                  {tr(fr, "Payé", "Paid")} {money(debt.paid, debt.currency)} ({debt.percent} %)
                </span>
                <span className="flex-1 text-right font-semibold text-ink">
                  {tr(fr, "Reste", "Left")} {money(debt.remaining, debt.currency)}
                </span>
                {!debt.closed ? (
                  <Button size="sm" variant="outline" onClick={() => onPay(debt)}>
                    {debt.direction === "owed_to_me" ? tr(fr, "Reçu", "Received") : tr(fr, "Payer", "Pay")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Recurrings({ fr, base, summary, month, onSaved }: { fr: boolean; base: string; summary: Summary; month: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "expense" as Kind, label: "", amount: "", currency: summary.settings.displayCurrency as Currency, categoryId: "", debtId: "", dayOfMonth: "1" });
  const create = useMutation({
    mutationFn: () =>
      post(`${base}/recurring`, {
        kind: form.kind,
        label: form.label.trim(),
        amount: Number(form.amount.replace(",", ".")),
        currency: form.currency,
        categoryId: form.kind === "debt_payment" ? null : form.categoryId || null,
        debtId: form.kind === "debt_payment" ? form.debtId || null : null,
        dayOfMonth: Number(form.dayOfMonth) || 1,
      }),
    onSuccess: () => {
      setOpen(false);
      setForm((current) => ({ ...current, label: "", amount: "" }));
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const record = useMutation({
    mutationFn: (id: string) => post(`${base}/recurring/${id}/record?month=${month}`, {}),
    onSuccess: () => {
      toast.success(tr(fr, "Enregistré pour ce mois.", "Recorded for this month."));
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggle = useMutation({
    mutationFn: (row: Recurring) => patch(`${base}/recurring/${row.id}`, { active: !row.active }),
    onSuccess: onSaved,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`${base}/recurring/${id}`),
    onSuccess: onSaved,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const categories = summary.categories.filter((category) => category.kind === (form.kind === "income" ? "income" : "expense"));
  const pending = summary.recurring.filter((row) => row.active && !row.doneThisMonth);
  const pendingOutUsd = pending
    .filter((row) => row.kind !== "income")
    .reduce((sum, row) => sum + (row.currency === "USD" ? row.amount : row.amount / summary.settings.cdfPerUsd), 0);
  const recurringLabel = useMemo(
    () => ({ income: tr(fr, "Revenu", "Income"), expense: tr(fr, "Dépense", "Expense"), debt_payment: tr(fr, "Dette", "Debt") }),
    [fr],
  );
  return (
    <Panel
      title={tr(fr, "Chaque mois", "Every month")}
      icon={<Repeat className="size-4" />}
      action={
        <button type="button" className="text-xs font-semibold text-brand" onClick={() => setOpen((value) => !value)}>
          {open ? tr(fr, "Fermer", "Close") : tr(fr, "+ Récurrent", "+ Recurring")}
        </button>
      }
    >
      {pendingOutUsd > 0 ? (
        <p className="mb-3 rounded-xl bg-brand/[.07] px-3 py-2 text-sm text-ink">
          {tr(fr, "Encore à payer ce mois", "Still to pay this month")} : <b className="tabular-nums">{money(pendingOutUsd, "USD")}</b>
        </p>
      ) : null}
      {open ? (
        <form
          className="mb-3 space-y-2 rounded-xl border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.label.trim() || !(Number(form.amount.replace(",", ".")) > 0)) return toast.error(tr(fr, "Nom et montant requis.", "Name and amount required."));
            if (form.kind === "debt_payment" && !form.debtId) return toast.error(tr(fr, "Choisissez la dette.", "Choose the debt."));
            create.mutate();
          }}
        >
          <select className={selectClass} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Kind, categoryId: "" })}>
            <option value="expense">{tr(fr, "Dépense (loyer, abonnement…)", "Expense (rent, subscription…)")}</option>
            <option value="income">{tr(fr, "Revenu (salaire…)", "Income (salary…)")}</option>
            <option value="debt_payment">{tr(fr, "Remboursement de dette", "Debt repayment")}</option>
          </select>
          <Input placeholder={tr(fr, "Nom (ex. Loyer)", "Name (e.g. Rent)")} value={form.label} maxLength={120} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          <div className="grid grid-cols-[1fr_auto_5rem] gap-2">
            <Input inputMode="decimal" placeholder={tr(fr, "Montant", "Amount")} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            <select className={selectClass} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as Currency })}>
              <option value="USD">$</option>
              <option value="CDF">FC</option>
            </select>
            <Input type="number" min={1} max={28} title={tr(fr, "Jour du mois", "Day of month")} value={form.dayOfMonth} onChange={(event) => setForm({ ...form, dayOfMonth: event.target.value })} />
          </div>
          {form.kind === "debt_payment" ? (
            <select className={selectClass} value={form.debtId} onChange={(event) => setForm({ ...form, debtId: event.target.value })}>
              <option value="">{tr(fr, "Dette…", "Debt…")}</option>
              {summary.debts.filter((debt) => !debt.closed).map((debt) => (
                <option key={debt.id} value={debt.id}>
                  {debt.name}
                </option>
              ))}
            </select>
          ) : (
            <select className={selectClass} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">{tr(fr, "Catégorie…", "Category…")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" className="w-full" loading={create.isPending}>
            {tr(fr, "Ajouter", "Add")}
          </Button>
        </form>
      ) : null}
      {summary.recurring.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          {tr(fr, "Ajoutez votre salaire, loyer, abonnements… pour les retrouver chaque mois.", "Add your salary, rent, subscriptions… to find them every month.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {summary.recurring.map((row) => (
            <li key={row.id} className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 ${row.active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{row.label}</p>
                <p className="truncate text-xs text-ink-muted">
                  {[recurringLabel[row.kind], `${tr(fr, "le", "on the")} ${row.dayOfMonth}`, row.debtName ?? row.categoryName].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${row.kind === "income" ? "text-good" : "text-ink"}`}>{money(row.amount, row.currency)}</span>
              {row.doneThisMonth ? (
                <span className="flex items-center gap-1 rounded-lg bg-good/10 px-2 py-1 text-xs font-semibold text-good">
                  <Check className="size-3.5" />
                  {row.kind === "income" ? tr(fr, "Reçu", "Received") : tr(fr, "Payé", "Paid")}
                </span>
              ) : row.active ? (
                <Button size="sm" variant="outline" loading={record.isPending && record.variables === row.id} onClick={() => record.mutate(row.id)}>
                  {row.kind === "income" ? tr(fr, "Reçu ?", "Received?") : tr(fr, "Payé ?", "Paid?")}
                </Button>
              ) : null}
              <button type="button" className="rounded p-1 text-ink-muted hover:text-ink" title={row.active ? tr(fr, "Mettre en pause", "Pause") : tr(fr, "Réactiver", "Resume")} onClick={() => toggle.mutate(row)}>
                {row.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <button
                type="button"
                className="rounded p-1 text-ink-muted hover:text-critical"
                aria-label={tr(fr, "Supprimer", "Delete")}
                onClick={async () => {
                  if (await confirmDialog({ title: tr(fr, "Supprimer ce récurrent ?", "Delete this recurring entry?"), message: tr(fr, "Les mouvements déjà enregistrés restent.", "Entries already recorded stay."), tone: "danger", confirmLabel: tr(fr, "Supprimer", "Delete") }))
                    remove.mutate(row.id);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Trend({ fr, summary, show }: { fr: boolean; summary: Summary; show: (usd: number) => string }) {
  if (summary.history.length < 2) return null;
  const max = Math.max(1, ...summary.history.flatMap((row) => [row.inUsd, row.outUsd]));
  return (
    <Panel title={tr(fr, "6 derniers mois", "Last 6 months")} icon={<CalendarClock className="size-4" />}>
      <ul className="space-y-2">
        {summary.history.map((row) => (
          <li key={row.month} className="text-xs">
            <div className="flex justify-between text-ink-secondary">
              <span className="capitalize">{new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString(fr ? "fr-FR" : "en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}</span>
              <span className={row.inUsd - row.outUsd >= 0 ? "text-good" : "text-critical"}>{show(row.inUsd - row.outUsd)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-good/70" style={{ width: `${(row.inUsd / max) * 100}%` }} />
            <div className="mt-0.5 h-1.5 rounded-full bg-critical/60" style={{ width: `${(row.outUsd / max) * 100}%` }} />
          </li>
        ))}
      </ul>
      <p className="mt-2 flex gap-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-good/70" />{tr(fr, "Entrées", "In")}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-critical/60" />{tr(fr, "Sorties", "Out")}</span>
      </p>
    </Panel>
  );
}

function SettingsButton({ fr, base, settings, onSaved }: { fr: boolean; base: string; settings: Summary["settings"]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(String(settings.cdfPerUsd));
  const save = useMutation({
    mutationFn: (input: { cdfPerUsd?: number; displayCurrency?: Currency }) => put(`${base}/settings`, input),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="relative flex items-center gap-1">
      <div className="flex rounded-xl border border-border bg-surface-1 p-1">
        {(["USD", "CDF"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => save.mutate({ displayCurrency: value })}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold ${settings.displayCurrency === value ? "bg-surface-3 text-ink" : "text-ink-muted"}`}
          >
            {value === "USD" ? "$" : "FC"}
          </button>
        ))}
      </div>
      <button type="button" className="rounded-xl border border-border bg-surface-1 p-2 text-ink-secondary hover:text-ink" aria-label={tr(fr, "Taux", "Rate")} onClick={() => setOpen((value) => !value)}>
        <Settings2 className="size-4" />
      </button>
      {open ? (
        <form
          className="absolute right-0 top-11 z-20 w-64 space-y-2 rounded-xl border border-border bg-surface-1 p-3 shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(rate.replace(",", "."));
            if (value > 0) save.mutate({ cdfPerUsd: value });
          }}
        >
          <Field label={tr(fr, "Taux : FC pour 1 $", "Rate: FC for $1")} hint={tr(fr, "Utilisé pour les nouveaux mouvements.", "Used for new entries.")}>
            <Input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" className="w-full" loading={save.isPending}>
            {tr(fr, "Enregistrer", "Save")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
