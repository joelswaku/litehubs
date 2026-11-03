/**
 * "Mes finances" — the workspace owner's personal money.
 *
 * Private by construction: routes are owner-only, and every query is scoped to
 * (organization_id, user_id) of the caller, so even another owner of the same
 * workspace, or a future owner after a transfer, never sees these rows.
 *
 * Amounts are kept in the currency they were entered in (USD or CDF) with the
 * rate of the day, and an amount_usd snapshot: totals are in USD, shown in FC
 * with the current rate when the owner prefers francs.
 */
import type { PoolClient } from "pg";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CategoryInput,
  CategoryUpdateInput,
  DebtInput,
  DebtUpdateInput,
  RecurringInput,
  RecurringUpdateInput,
  SettingsInput,
  TransactionInput,
  TransactionUpdateInput,
} from "./personal-finance.validation";

export type FinanceContext = { organizationId: string; userId: string };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Currency = "USD" | "CDF";

const DEFAULT_CATEGORIES: { kind: "income" | "expense"; name: string; color: string }[] = [
  { kind: "income", name: "Salaire", color: "#16a34a" },
  { kind: "income", name: "Autre revenu", color: "#0d9488" },
  { kind: "expense", name: "Carburant", color: "#ea580c" },
  { kind: "expense", name: "Nourriture", color: "#ca8a04" },
  { kind: "expense", name: "Loyer et maison", color: "#7c3aed" },
  { kind: "expense", name: "Transport", color: "#2563eb" },
  { kind: "expense", name: "Téléphone et internet", color: "#0891b2" },
  { kind: "expense", name: "Eau et électricité", color: "#0284c7" },
  { kind: "expense", name: "Santé", color: "#dc2626" },
  { kind: "expense", name: "Famille", color: "#db2777" },
  { kind: "expense", name: "Éducation", color: "#4f46e5" },
  { kind: "expense", name: "Loisirs", color: "#9333ea" },
  { kind: "expense", name: "Autre dépense", color: "#64748b" },
];

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown) => Number(value ?? 0);
const toUsd = (amount: number, currency: Currency, cdfPerUsd: number) =>
  round2(currency === "USD" ? amount : amount / cdfPerUsd);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function monthRange(month?: string) {
  const now = new Date();
  const [year, index] = month
    ? month.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(year!, index! - 1, 1));
  const end = new Date(Date.UTC(year!, index!, 1));
  return { key: `${year}-${String(index).padStart(2, "0")}`, start: isoDay(start), end: isoDay(end) };
}

function run<T>(context: FinanceContext, handler: (client: PoolClient) => Promise<T>) {
  return withTenantContext({ organizationId: context.organizationId, userId: context.userId }, handler);
}

/** Settings row and default categories, created on first visit. */
async function ensureSetup(client: PoolClient, context: FinanceContext) {
  const settings = await client.query<Row>(
    `INSERT INTO personal_finance_settings(organization_id,user_id) VALUES($1,$2)
     ON CONFLICT (organization_id,user_id) DO UPDATE SET organization_id=EXCLUDED.organization_id
     RETURNING cdf_per_usd,display_currency,(xmax = 0) AS created`,
    [context.organizationId, context.userId],
  );
  if (settings.rows[0]!.created) {
    for (const [index, category] of DEFAULT_CATEGORIES.entries())
      await client.query(
        `INSERT INTO personal_finance_categories(organization_id,user_id,kind,name,color,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
        [context.organizationId, context.userId, category.kind, category.name, category.color, index],
      );
  }
  return {
    cdfPerUsd: num(settings.rows[0]!.cdf_per_usd),
    displayCurrency: settings.rows[0]!.display_currency as Currency,
  };
}

async function owned(client: PoolClient, context: FinanceContext, table: string, id: string | null | undefined) {
  if (!id) return null;
  const found = await client.query<Row>(
    `SELECT * FROM ${table} WHERE organization_id=$1 AND user_id=$2 AND id=$3`,
    [context.organizationId, context.userId, id],
  );
  if (!found.rows[0]) throw new NotFoundError("Élément introuvable");
  return found.rows[0];
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export async function summary(context: FinanceContext, month?: string) {
  return run(context, async (client) => {
    const settings = await ensureSetup(client, context);
    const range = monthRange(month);
    const scope = [context.organizationId, context.userId];

    const categories = await client.query<Row>(
      `SELECT * FROM personal_finance_categories WHERE organization_id=$1 AND user_id=$2 AND archived_at IS NULL
        ORDER BY kind, sort_order, name`,
      scope,
    );
    const transactions = await client.query<Row>(
      `SELECT t.*,c.name AS category_name,c.color AS category_color,d.name AS debt_name,d.direction AS debt_direction,
              r.label AS recurring_label
         FROM personal_finance_transactions t
         LEFT JOIN personal_finance_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
         LEFT JOIN personal_finance_debts d ON d.organization_id=t.organization_id AND d.id=t.debt_id
         LEFT JOIN personal_finance_recurring r ON r.organization_id=t.organization_id AND r.id=t.recurring_id
        WHERE t.organization_id=$1 AND t.user_id=$2 AND t.occurred_on >= $3 AND t.occurred_on < $4
        ORDER BY t.occurred_on DESC, t.created_at DESC`,
      [...scope, range.start, range.end],
    );

    let income = 0;
    let expense = 0;
    let debtPaid = 0;
    let debtReceived = 0;
    const spentByCategory = new Map<string, number>();
    for (const row of transactions.rows) {
      const usd = num(row.amount_usd);
      if (row.kind === "income") income += usd;
      else if (row.kind === "expense") {
        expense += usd;
        const key = row.category_id ?? "none";
        spentByCategory.set(key, (spentByCategory.get(key) ?? 0) + usd);
      } else if (row.debt_direction === "owed_to_me") debtReceived += usd;
      else debtPaid += usd;
    }
    const totalIn = income + debtReceived;
    const totalOut = expense + debtPaid;

    const budgets = categories.rows
      .filter((row) => row.kind === "expense")
      .map((row) => {
        const budgetUsd =
          row.monthly_budget === null ? null : toUsd(num(row.monthly_budget), row.budget_currency, settings.cdfPerUsd);
        const spentUsd = round2(spentByCategory.get(row.id) ?? 0);
        return {
          categoryId: row.id as string,
          name: row.name as string,
          color: row.color as string | null,
          spentUsd,
          budgetUsd,
          percent: budgetUsd ? Math.round((spentUsd / budgetUsd) * 100) : null,
        };
      })
      .filter((row) => row.spentUsd > 0 || row.budgetUsd !== null)
      .sort((a, b) => b.spentUsd - a.spentUsd);
    const uncategorised = spentByCategory.get("none");
    if (uncategorised)
      budgets.push({ categoryId: "none", name: "Sans catégorie", color: "#94a3b8", spentUsd: round2(uncategorised), budgetUsd: null, percent: null });

    const debts = await listDebtsWith(client, context);
    const recurring = await client.query<Row>(
      `SELECT r.*,c.name AS category_name,d.name AS debt_name,
              EXISTS (SELECT 1 FROM personal_finance_transactions t
                       WHERE t.organization_id=r.organization_id AND t.recurring_id=r.id AND t.recurring_month=$3) AS done
         FROM personal_finance_recurring r
         LEFT JOIN personal_finance_categories c ON c.organization_id=r.organization_id AND c.id=r.category_id
         LEFT JOIN personal_finance_debts d ON d.organization_id=r.organization_id AND d.id=r.debt_id
        WHERE r.organization_id=$1 AND r.user_id=$2
        ORDER BY r.active DESC, r.day_of_month, r.label`,
      [...scope, range.start],
    );

    // Six months ending with the one shown, for the trend.
    const history = await client.query<Row>(
      `SELECT to_char(date_trunc('month', t.occurred_on),'YYYY-MM') AS month,
              SUM(CASE WHEN t.kind='income' OR (t.kind='debt_payment' AND d.direction='owed_to_me') THEN t.amount_usd ELSE 0 END) AS money_in,
              SUM(CASE WHEN t.kind='expense' OR (t.kind='debt_payment' AND d.direction='i_owe') THEN t.amount_usd ELSE 0 END) AS money_out
         FROM personal_finance_transactions t
         LEFT JOIN personal_finance_debts d ON d.organization_id=t.organization_id AND d.id=t.debt_id
        WHERE t.organization_id=$1 AND t.user_id=$2
          AND t.occurred_on >= ($3::date - interval '5 months') AND t.occurred_on < $4
        GROUP BY 1 ORDER BY 1`,
      [...scope, range.start, range.end],
    );

    return {
      month: range.key,
      settings,
      totals: {
        incomeUsd: round2(income),
        expenseUsd: round2(expense),
        debtPaidUsd: round2(debtPaid),
        debtReceivedUsd: round2(debtReceived),
        inUsd: round2(totalIn),
        outUsd: round2(totalOut),
        remainingUsd: round2(totalIn - totalOut),
        spentPercent: totalIn > 0 ? Math.round((totalOut / totalIn) * 100) : null,
      },
      budgets,
      debts,
      recurring: recurring.rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        label: row.label as string,
        amount: num(row.amount),
        currency: row.currency as Currency,
        categoryId: row.category_id as string | null,
        categoryName: row.category_name as string | null,
        debtId: row.debt_id as string | null,
        debtName: row.debt_name as string | null,
        dayOfMonth: num(row.day_of_month),
        active: Boolean(row.active),
        doneThisMonth: Boolean(row.done),
      })),
      categories: categories.rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as "income" | "expense",
        name: row.name as string,
        color: row.color as string | null,
        monthlyBudget: row.monthly_budget === null ? null : num(row.monthly_budget),
        budgetCurrency: row.budget_currency as Currency,
      })),
      transactions: transactions.rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        amount: num(row.amount),
        currency: row.currency as Currency,
        amountUsd: num(row.amount_usd),
        categoryId: row.category_id as string | null,
        categoryName: row.category_name as string | null,
        categoryColor: row.category_color as string | null,
        debtId: row.debt_id as string | null,
        debtName: row.debt_name as string | null,
        recurringLabel: row.recurring_label as string | null,
        occurredOn: isoDay(new Date(row.occurred_on)),
        note: row.note as string | null,
      })),
      history: history.rows.map((row) => ({ month: row.month as string, inUsd: round2(num(row.money_in)), outUsd: round2(num(row.money_out)) })),
    };
  });
}

async function listDebtsWith(client: PoolClient, context: FinanceContext) {
  const debts = await client.query<Row>(
    `SELECT d.*,
            COALESCE(SUM(CASE WHEN t.currency=d.currency THEN t.amount
                              WHEN d.currency='USD' THEN t.amount / t.cdf_per_usd
                              ELSE t.amount * t.cdf_per_usd END),0) AS paid,
            MAX(t.occurred_on) AS last_payment_on
       FROM personal_finance_debts d
       LEFT JOIN personal_finance_transactions t ON t.organization_id=d.organization_id AND t.debt_id=d.id
      WHERE d.organization_id=$1 AND d.user_id=$2
        AND (d.closed_at IS NULL OR d.closed_at > now() - interval '60 days')
      GROUP BY d.id
      ORDER BY (d.closed_at IS NOT NULL), d.due_on NULLS LAST, d.created_at`,
    [context.organizationId, context.userId],
  );
  return debts.rows.map((row) => {
    const amount = num(row.amount);
    const paid = round2(num(row.paid));
    return {
      id: row.id as string,
      direction: row.direction as "i_owe" | "owed_to_me",
      name: row.name as string,
      counterparty: row.counterparty as string | null,
      amount,
      currency: row.currency as Currency,
      paid,
      remaining: round2(Math.max(0, amount - paid)),
      percent: Math.min(100, Math.round((paid / amount) * 100)),
      startedOn: row.started_on ? isoDay(new Date(row.started_on)) : null,
      dueOn: row.due_on ? isoDay(new Date(row.due_on)) : null,
      lastPaymentOn: row.last_payment_on ? isoDay(new Date(row.last_payment_on)) : null,
      note: row.note as string | null,
      closed: Boolean(row.closed_at),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Settings and categories                                             */
/* ------------------------------------------------------------------ */

export async function saveSettings(context: FinanceContext, input: SettingsInput) {
  return run(context, async (client) => {
    await ensureSetup(client, context);
    await client.query(
      `UPDATE personal_finance_settings
          SET cdf_per_usd=COALESCE($3,cdf_per_usd),display_currency=COALESCE($4,display_currency),updated_at=now()
        WHERE organization_id=$1 AND user_id=$2`,
      [context.organizationId, context.userId, input.cdfPerUsd ?? null, input.displayCurrency ?? null],
    );
    return { saved: true };
  });
}

export async function createCategory(context: FinanceContext, input: CategoryInput) {
  return run(context, async (client) => {
    await ensureSetup(client, context);
    const created = await client.query<{ id: string }>(
      `INSERT INTO personal_finance_categories(organization_id,user_id,kind,name,monthly_budget,budget_currency,color,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7,
              (SELECT COALESCE(MAX(sort_order),0)+1 FROM personal_finance_categories WHERE organization_id=$1 AND user_id=$2))
       RETURNING id`,
      [context.organizationId, context.userId, input.kind, input.name, input.monthlyBudget ?? null, input.budgetCurrency, input.color ?? null],
    );
    return { id: created.rows[0]!.id };
  });
}

export async function updateCategory(context: FinanceContext, id: string, input: CategoryUpdateInput) {
  return run(context, async (client) => {
    await owned(client, context, "personal_finance_categories", id);
    await client.query(
      `UPDATE personal_finance_categories
          SET name=COALESCE($4,name),
              monthly_budget=CASE WHEN $5 THEN $6::numeric ELSE monthly_budget END,
              budget_currency=COALESCE($7,budget_currency),
              color=COALESCE($8,color),
              archived_at=CASE WHEN $9::boolean IS TRUE THEN now() WHEN $9::boolean IS FALSE THEN NULL ELSE archived_at END
        WHERE organization_id=$1 AND user_id=$2 AND id=$3`,
      [
        context.organizationId,
        context.userId,
        id,
        input.name ?? null,
        input.monthlyBudget !== undefined,
        input.monthlyBudget ?? null,
        input.budgetCurrency ?? null,
        input.color ?? null,
        input.archived ?? null,
      ],
    );
    return { saved: true };
  });
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

async function checkLinks(
  client: PoolClient,
  context: FinanceContext,
  kind: string,
  categoryId: string | null | undefined,
  debtId: string | null | undefined,
) {
  const category = await owned(client, context, "personal_finance_categories", categoryId);
  if (category && kind !== "debt_payment" && category.kind !== kind)
    throw new BadRequestError(kind === "income" ? "Choisissez une catégorie de revenu." : "Choisissez une catégorie de dépense.");
  const debt = await owned(client, context, "personal_finance_debts", debtId);
  return { category, debt };
}

export async function createTransaction(
  context: FinanceContext,
  input: TransactionInput & { recurringId?: string; recurringMonth?: string },
) {
  return run(context, async (client) => {
    const settings = await ensureSetup(client, context);
    await checkLinks(client, context, input.kind, input.categoryId, input.kind === "debt_payment" ? input.debtId : null);
    const created = await client.query<{ id: string }>(
      `INSERT INTO personal_finance_transactions
         (organization_id,user_id,kind,amount,currency,cdf_per_usd,amount_usd,category_id,debt_id,occurred_on,note,recurring_id,recurring_month)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date,CURRENT_DATE),$11,$12,$13)
       RETURNING id`,
      [
        context.organizationId,
        context.userId,
        input.kind,
        input.amount,
        input.currency,
        settings.cdfPerUsd,
        toUsd(input.amount, input.currency, settings.cdfPerUsd),
        input.kind === "debt_payment" ? null : (input.categoryId ?? null),
        input.kind === "debt_payment" ? input.debtId : null,
        input.occurredOn ?? null,
        input.note ?? null,
        input.recurringId ?? null,
        input.recurringMonth ?? null,
      ],
    );
    // Fully repaid: the debt closes by itself.
    if (input.kind === "debt_payment") await autoClose(client, context, input.debtId!);
    return { id: created.rows[0]!.id };
  });
}

async function autoClose(client: PoolClient, context: FinanceContext, debtId: string) {
  const [debt] = (await listDebtsWith(client, context)).filter((row) => row.id === debtId);
  if (debt && !debt.closed && debt.remaining <= 0)
    await client.query(`UPDATE personal_finance_debts SET closed_at=now() WHERE organization_id=$1 AND user_id=$2 AND id=$3`, [
      context.organizationId,
      context.userId,
      debtId,
    ]);
}

export async function updateTransaction(context: FinanceContext, id: string, input: TransactionUpdateInput) {
  return run(context, async (client) => {
    const current = await owned(client, context, "personal_finance_transactions", id);
    await checkLinks(client, context, current!.kind, input.categoryId, null);
    const amount = input.amount ?? num(current!.amount);
    const currency = (input.currency ?? current!.currency) as Currency;
    const rate = num(current!.cdf_per_usd);
    await client.query(
      `UPDATE personal_finance_transactions
          SET amount=$4,currency=$5,amount_usd=$6,
              category_id=CASE WHEN $7 THEN $8::uuid ELSE category_id END,
              occurred_on=COALESCE($9::date,occurred_on),
              note=CASE WHEN $10 THEN $11 ELSE note END
        WHERE organization_id=$1 AND user_id=$2 AND id=$3`,
      [
        context.organizationId,
        context.userId,
        id,
        amount,
        currency,
        toUsd(amount, currency, rate),
        input.categoryId !== undefined && current!.kind !== "debt_payment",
        input.categoryId ?? null,
        input.occurredOn ?? null,
        input.note !== undefined,
        input.note ?? null,
      ],
    );
    if (current!.debt_id) await autoClose(client, context, current!.debt_id);
    return { saved: true };
  });
}

export async function deleteTransaction(context: FinanceContext, id: string) {
  return run(context, async (client) => {
    const current = await owned(client, context, "personal_finance_transactions", id);
    await client.query(`DELETE FROM personal_finance_transactions WHERE organization_id=$1 AND user_id=$2 AND id=$3`, [
      context.organizationId,
      context.userId,
      id,
    ]);
    // A payment removed: the debt may be open again.
    if (current!.debt_id)
      await client.query(
        `UPDATE personal_finance_debts d SET closed_at=NULL
          WHERE d.organization_id=$1 AND d.user_id=$2 AND d.id=$3 AND d.closed_at IS NOT NULL`,
        [context.organizationId, context.userId, current!.debt_id],
      );
    return { deleted: true };
  });
}

/* ------------------------------------------------------------------ */
/* Debts                                                               */
/* ------------------------------------------------------------------ */

export async function createDebt(context: FinanceContext, input: DebtInput) {
  return run(context, async (client) => {
    await ensureSetup(client, context);
    const created = await client.query<{ id: string }>(
      `INSERT INTO personal_finance_debts(organization_id,user_id,direction,name,counterparty,amount,currency,started_on,due_on,note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        context.organizationId,
        context.userId,
        input.direction,
        input.name,
        input.counterparty ?? null,
        input.amount,
        input.currency,
        input.startedOn ?? null,
        input.dueOn ?? null,
        input.note ?? null,
      ],
    );
    return { id: created.rows[0]!.id };
  });
}

export async function updateDebt(context: FinanceContext, id: string, input: DebtUpdateInput) {
  return run(context, async (client) => {
    await owned(client, context, "personal_finance_debts", id);
    await client.query(
      `UPDATE personal_finance_debts
          SET name=COALESCE($4,name),counterparty=CASE WHEN $5 THEN $6 ELSE counterparty END,
              amount=COALESCE($7,amount),currency=COALESCE($8,currency),
              due_on=CASE WHEN $9 THEN $10::date ELSE due_on END,
              note=CASE WHEN $11 THEN $12 ELSE note END,
              closed_at=CASE WHEN $13::boolean IS TRUE THEN COALESCE(closed_at,now()) WHEN $13::boolean IS FALSE THEN NULL ELSE closed_at END
        WHERE organization_id=$1 AND user_id=$2 AND id=$3`,
      [
        context.organizationId,
        context.userId,
        id,
        input.name ?? null,
        input.counterparty !== undefined,
        input.counterparty ?? null,
        input.amount ?? null,
        input.currency ?? null,
        input.dueOn !== undefined,
        input.dueOn ?? null,
        input.note !== undefined,
        input.note ?? null,
        input.closed ?? null,
      ],
    );
    return { saved: true };
  });
}

export async function deleteDebt(context: FinanceContext, id: string) {
  return run(context, async (client) => {
    await owned(client, context, "personal_finance_debts", id);
    // Its payments go with it (they only make sense against the debt).
    await client.query(`DELETE FROM personal_finance_debts WHERE organization_id=$1 AND user_id=$2 AND id=$3`, [
      context.organizationId,
      context.userId,
      id,
    ]);
    return { deleted: true };
  });
}

/* ------------------------------------------------------------------ */
/* Recurring entries                                                   */
/* ------------------------------------------------------------------ */

export async function createRecurring(context: FinanceContext, input: RecurringInput) {
  return run(context, async (client) => {
    await ensureSetup(client, context);
    await checkLinks(client, context, input.kind, input.categoryId, input.kind === "debt_payment" ? input.debtId : null);
    const created = await client.query<{ id: string }>(
      `INSERT INTO personal_finance_recurring(organization_id,user_id,kind,label,amount,currency,category_id,debt_id,day_of_month,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        context.organizationId,
        context.userId,
        input.kind,
        input.label,
        input.amount,
        input.currency,
        input.kind === "debt_payment" ? null : (input.categoryId ?? null),
        input.kind === "debt_payment" ? input.debtId : null,
        input.dayOfMonth,
        input.active,
      ],
    );
    return { id: created.rows[0]!.id };
  });
}

export async function updateRecurring(context: FinanceContext, id: string, input: RecurringUpdateInput) {
  return run(context, async (client) => {
    const current = await owned(client, context, "personal_finance_recurring", id);
    await checkLinks(client, context, current!.kind, input.categoryId, null);
    await client.query(
      `UPDATE personal_finance_recurring
          SET label=COALESCE($4,label),amount=COALESCE($5,amount),currency=COALESCE($6,currency),
              category_id=CASE WHEN $7 THEN $8::uuid ELSE category_id END,
              day_of_month=COALESCE($9,day_of_month),active=COALESCE($10,active)
        WHERE organization_id=$1 AND user_id=$2 AND id=$3`,
      [
        context.organizationId,
        context.userId,
        id,
        input.label ?? null,
        input.amount ?? null,
        input.currency ?? null,
        input.categoryId !== undefined && current!.kind !== "debt_payment",
        input.categoryId ?? null,
        input.dayOfMonth ?? null,
        input.active ?? null,
      ],
    );
    return { saved: true };
  });
}

export async function deleteRecurring(context: FinanceContext, id: string) {
  return run(context, async (client) => {
    await owned(client, context, "personal_finance_recurring", id);
    await client.query(`DELETE FROM personal_finance_recurring WHERE organization_id=$1 AND user_id=$2 AND id=$3`, [
      context.organizationId,
      context.userId,
      id,
    ]);
    return { deleted: true };
  });
}

/** "Payé" / "Reçu" on a recurring line: records it once for that month. */
export async function recordRecurring(context: FinanceContext, id: string, month?: string) {
  const range = monthRange(month);
  const recurring = await run(context, (client) => owned(client, context, "personal_finance_recurring", id));
  const today = new Date();
  const monthStart = new Date(`${range.start}T00:00:00Z`);
  const day = Math.min(num(recurring!.day_of_month), 28);
  // Same month as today: dated today; another month: dated on its usual day.
  const occurredOn =
    monthStart.getUTCFullYear() === today.getUTCFullYear() && monthStart.getUTCMonth() === today.getUTCMonth()
      ? isoDay(today)
      : `${range.key}-${String(day).padStart(2, "0")}`;
  try {
    return await createTransaction(context, {
      kind: recurring!.kind,
      amount: num(recurring!.amount),
      currency: recurring!.currency,
      categoryId: recurring!.category_id,
      debtId: recurring!.debt_id,
      occurredOn,
      note: recurring!.label,
      recurringId: id,
      recurringMonth: range.start,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new BadRequestError("Déjà enregistré pour ce mois.");
    throw error;
  }
}

