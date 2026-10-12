/**
 * Printable sales documents: invoice (Facture), payment receipt (Reçu de
 * paiement), customer statement (Relevé client) and the period sales &
 * expenses report. Every loader applies the same organization, permission and
 * province rules as the matching JSON endpoint.
 */
import type { PoolClient } from "pg";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { createPdf, pdfDate, pdfMoney } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import { listOwnerManagementRecords } from "../owner-management/owner-management.service";
import { customerDetail, maySeeProvince, type SalesContext } from "./sales.service";

type Row = Record<string, unknown>;
type PdfFile = { buffer: Buffer; fileName: string };

const num = (value: unknown) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
};
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const qty = (value: unknown) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(num(value)).replace(/ | /g, " ");
const pct = (value: unknown) => (num(value) ? `${qty(value)} %` : "—");
const fileSafe = (value: unknown) => str(value).replace(/[^\w-]+/g, "-") || "document";

const METHOD: Record<string, string> = {
  cash: "Espèces",
  bank_transfer: "Virement bancaire",
  mobile_money: "Mobile Money",
  cheque: "Chèque",
  card: "Carte",
  offset: "Compensation",
};
const INVOICE_STATUS: Record<string, string> = {
  draft: "Brouillon",
  issued: "Émise",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
};
const EXPENSE_STATUS: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  approved: "Approuvée",
  paid: "Payée",
  rejected: "Rejetée",
  cancelled: "Annulée",
};
const CUSTOMER_TYPE: Record<string, string> = {
  business: "Entreprise",
  individual: "Particulier",
  government: "Administration",
  cooperative: "Coopérative",
  internal: "Interne",
};
const label = (map: Record<string, string>, value: unknown) => map[str(value)] ?? (str(value).replaceAll("_", " ") || "—");

const addressOf = (customer: Row) =>
  [customer.address_line1 ?? customer.addressLine1, customer.address_line2 ?? customer.addressLine2, customer.city, customer.region, customer.postal_code ?? customer.postalCode, customer.country]
    .map(str)
    .filter(Boolean)
    .join(", ");

/** Caches province checks so long lists only query each province once. */
function provinceGate(client: PoolClient, context: SalesContext) {
  const cache = new Map<string, Promise<boolean>>();
  return (provinceId: unknown) => {
    const key = str(provinceId);
    if (!cache.has(key)) cache.set(key, maySeeProvince(client, context, key || null).catch(() => false));
    return cache.get(key)!;
  };
}

/* ------------------------------------------------------------------ */
/* Facture                                                              */
/* ------------------------------------------------------------------ */

async function invoiceIdForOrder(client: PoolClient, context: SalesContext, orderId: string) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM sales_invoices WHERE organization_id=$1 AND order_id=$2 AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1",
    [context.organizationId, orderId],
  );
  if (!result.rowCount) throw new NotFoundError("No invoice has been issued for this sales order");
  return result.rows[0]!.id;
}

export async function invoicePdf(context: SalesContext, ref: { invoiceId?: string; orderId?: string }): Promise<PdfFile> {
  return withTenantContext(context, async (client) => {
    const invoiceId = ref.invoiceId ?? (await invoiceIdForOrder(client, context, ref.orderId!));
    const found = await client.query<Row>(
      `SELECT i.*, i.invoice_date::text AS invoice_day, i.due_date::text AS due_day,
              o.order_number, o.order_date::text AS order_day,
              c.name AS customer_name, c.code AS customer_code, c.customer_type, c.contact_name, c.phone, c.email,
              c.address_line1, c.address_line2, c.city, c.region, c.postal_code, c.country, c.payment_terms_days,
              c.province_id AS customer_province_id
         FROM sales_invoices i
         JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
         LEFT JOIN sales_orders o ON o.organization_id=i.organization_id AND o.id=i.order_id
        WHERE i.organization_id=$1 AND i.id=$2`,
      [context.organizationId, invoiceId],
    );
    const invoice = found.rows[0];
    if (!invoice) throw new NotFoundError("Invoice not found");
    const visible = provinceGate(client, context);
    if (!(await visible(invoice.province_id)) || !(await visible(invoice.customer_province_id))) throw new NotFoundError("Invoice not found");

    const [lines, payments] = await Promise.all([
      client.query<Row>("SELECT * FROM sales_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 ORDER BY line_number", [context.organizationId, invoiceId]),
      client.query<Row>(
        `SELECT p.payment_number, p.received_on::text AS received_day, p.method, p.reference, a.amount
           FROM payment_allocations a
           JOIN customer_payments p ON p.organization_id=a.organization_id AND p.id=a.payment_id
          WHERE a.organization_id=$1 AND a.invoice_id=$2
          ORDER BY p.received_on, p.created_at`,
        [context.organizationId, invoiceId],
      ),
    ]);
    const currency = str(invoice.currency);
    const total = num(invoice.total);
    const paid = num(invoice.paid_total);
    const balance = Math.max(0, total - paid);

    const pdf = await createPdf(client, context.organizationId, {
      title: "Facture",
      reference: str(invoice.invoice_number),
      subtitle: `Statut : ${label(INVOICE_STATUS, invoice.status)}`,
    });
    pdf.section("Facturé à").fields([
      ["Client", `${str(invoice.customer_name)}${invoice.customer_code ? ` (${str(invoice.customer_code)})` : ""}`],
      ["Type", label(CUSTOMER_TYPE, invoice.customer_type)],
      ["Contact", invoice.contact_name],
      ["Téléphone / e-mail", [str(invoice.phone), str(invoice.email)].filter(Boolean).join(" · ")],
      ["Adresse", addressOf(invoice)],
    ]);
    pdf.section("Références").fields(
      [
        ["Date de facture", pdfDate(invoice.invoice_day)],
        ["Date d'échéance", pdfDate(invoice.due_day)],
        ["Commande", invoice.order_number ? `${str(invoice.order_number)} du ${pdfDate(invoice.order_day)}` : "—"],
        ["Délai de paiement", `${num(invoice.payment_terms_days)} jours`],
        ["Devise", currency],
        ["Statut", label(INVOICE_STATUS, invoice.status)],
      ],
      3,
    );
    pdf.section("Détail");
    pdf.table(
      [
        { label: "N°", width: 0.4, align: "center" },
        { label: "Désignation", width: 3 },
        { label: "Qté", width: 0.9, align: "right" },
        { label: "Unité", width: 0.7 },
        { label: "Prix unitaire", width: 1.3, align: "right" },
        { label: "Remise", width: 0.7, align: "right" },
        { label: "TVA", width: 0.7, align: "right" },
        { label: "Montant", width: 1.4, align: "right" },
      ],
      lines.rows.map((line) => [
        line.line_number,
        line.description,
        qty(line.quantity),
        line.unit,
        pdfMoney(line.unit_price, currency),
        pct(line.discount_percent),
        pct(line.tax_percent),
        pdfMoney(line.line_total, currency),
      ]),
      { empty: "Aucune ligne." },
    );
    pdf.table(
      [{ label: "Récapitulatif", width: 3 }, { label: "Montant", width: 1.4, align: "right" }],
      [
        ["Sous-total HT", pdfMoney(invoice.subtotal, currency)],
        ...(num(invoice.discount_total) ? [["Remises", `- ${pdfMoney(invoice.discount_total, currency)}`]] : []),
        ["Taxes", pdfMoney(invoice.tax_total, currency)],
        ["Total TTC", pdfMoney(total, currency)],
        ["Déjà réglé", pdfMoney(paid, currency)],
      ],
      { totals: ["Reste à payer", pdfMoney(balance, currency)] },
    );
    if (payments.rowCount) {
      pdf.section("Règlements reçus");
      pdf.table(
        [{ label: "Reçu", width: 1.4 }, { label: "Date", width: 1 }, { label: "Mode", width: 1.2 }, { label: "Référence", width: 1.4 }, { label: "Montant affecté", width: 1.3, align: "right" }],
        payments.rows.map((payment) => [payment.payment_number, pdfDate(payment.received_day), label(METHOD, payment.method), payment.reference, pdfMoney(payment.amount, currency)]),
      );
    }
    if (str(invoice.notes)) pdf.section("Notes").paragraph(str(invoice.notes));
    pdf.note(
      balance > 0
        ? `Merci de régler ${pdfMoney(balance, currency)} au plus tard le ${pdfDate(invoice.due_day)} en rappelant la référence ${str(invoice.invoice_number)}.`
        : "Cette facture est entièrement réglée. Merci pour votre confiance.",
    );
    pdf.signatures(["Pour l'entreprise (cachet et signature)", "Client"]);
    return { buffer: await pdf.finish(), fileName: `facture-${fileSafe(invoice.invoice_number)}.pdf` };
  });
}

/* ------------------------------------------------------------------ */
/* Reçu de paiement                                                     */
/* ------------------------------------------------------------------ */

export async function paymentReceiptPdf(context: SalesContext, paymentId: string): Promise<PdfFile> {
  return withTenantContext(context, async (client) => {
    const found = await client.query<Row>(
      `SELECT p.*, p.received_on::text AS received_day,
              c.name AS customer_name, c.code AS customer_code, c.contact_name, c.phone, c.email,
              c.address_line1, c.address_line2, c.city, c.region, c.postal_code, c.country, c.province_id,
              u.full_name AS recorded_by_name
         FROM customer_payments p
         JOIN customers c ON c.organization_id=p.organization_id AND c.id=p.customer_id
         LEFT JOIN users u ON u.id=p.recorded_by
        WHERE p.organization_id=$1 AND p.id=$2`,
      [context.organizationId, paymentId],
    );
    const payment = found.rows[0];
    if (!payment || !(await maySeeProvince(client, context, (payment.province_id as string | null) ?? null))) throw new NotFoundError("Payment not found");
    const allocations = await client.query<Row>(
      `SELECT i.invoice_number, i.invoice_date::text AS invoice_day, i.total, i.paid_total, a.amount
         FROM payment_allocations a
         JOIN sales_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
        WHERE a.organization_id=$1 AND a.payment_id=$2
        ORDER BY i.invoice_date, i.invoice_number`,
      [context.organizationId, paymentId],
    );
    const currency = str(payment.currency);
    const amount = num(payment.amount);
    const allocated = allocations.rows.reduce((sum, row) => sum + num(row.amount), 0);

    const pdf = await createPdf(client, context.organizationId, { title: "Reçu de paiement", reference: str(payment.payment_number) });
    pdf.stats([
      ["Montant reçu", pdfMoney(amount, currency)],
      ["Date", pdfDate(payment.received_day)],
      ["Mode de paiement", label(METHOD, payment.method)],
    ]);
    pdf.section("Reçu de").fields([
      ["Client", `${str(payment.customer_name)}${payment.customer_code ? ` (${str(payment.customer_code)})` : ""}`],
      ["Contact", [str(payment.contact_name), str(payment.phone), str(payment.email)].filter(Boolean).join(" · ")],
      ["Adresse", addressOf(payment)],
      ["Référence de la transaction", payment.reference],
    ]);
    pdf.section("Affectation");
    pdf.table(
      [{ label: "Facture", width: 1.5 }, { label: "Date", width: 1 }, { label: "Total facture", width: 1.3, align: "right" }, { label: "Montant affecté", width: 1.3, align: "right" }, { label: "Reste dû", width: 1.3, align: "right" }],
      allocations.rows.map((row) => [row.invoice_number, pdfDate(row.invoice_day), pdfMoney(row.total, currency), pdfMoney(row.amount, currency), pdfMoney(Math.max(0, num(row.total) - num(row.paid_total)), currency)]),
      { empty: "Paiement non affecté à une facture (acompte ou avance client).", totals: allocations.rowCount ? ["Total affecté", "", "", pdfMoney(allocated, currency), ""] : undefined },
    );
    if (amount - allocated > 0.005) pdf.paragraph(`Montant non affecté (avance au crédit du client) : ${pdfMoney(amount - allocated, currency)}.`);
    if (str(payment.notes)) pdf.section("Notes").paragraph(str(payment.notes));
    pdf.fields([["Enregistré par", payment.recorded_by_name], ["Enregistré le", pdfDate(payment.created_at, true)]]);
    pdf.note(`Nous reconnaissons avoir reçu la somme de ${pdfMoney(amount, currency)} de ${str(payment.customer_name)}. Ce reçu ne vaut quittance que pour le montant indiqué.`);
    pdf.signatures(["Reçu par (pour l'entreprise)", "Versé par (client)"]);
    return { buffer: await pdf.finish(), fileName: `recu-${fileSafe(payment.payment_number)}.pdf` };
  });
}

/* ------------------------------------------------------------------ */
/* Relevé client                                                        */
/* ------------------------------------------------------------------ */

type Movement = { date: string; kind: "invoice" | "payment"; reference: string; detail: string; debit: number; credit: number };

export async function customerStatementPdf(context: SalesContext, customerId: string, period: { from?: string; to?: string }): Promise<PdfFile> {
  // Same loader and province check as GET /customers/:id/detail.
  const detail = await customerDetail(context, customerId);
  const customer = detail.customer;
  const from = period.from ?? "";
  const to = period.to ?? "";
  const byCurrency = new Map<string, Movement[]>();
  const push = (currency: unknown, movement: Movement) => {
    const key = str(currency) || "CDF";
    byCurrency.set(key, [...(byCurrency.get(key) ?? []), movement]);
  };
  for (const invoice of detail.invoices) {
    if (str(invoice.status) === "cancelled") continue;
    push(invoice.currency, { date: str(invoice.invoiceDate), kind: "invoice", reference: str(invoice.invoiceNumber), detail: `Facture · échéance ${pdfDate(invoice.dueDate)}`, debit: num(invoice.total), credit: 0 });
  }
  for (const payment of detail.payments)
    push(payment.currency, { date: str(payment.receivedOn), kind: "payment", reference: str(payment.paymentNumber), detail: `Paiement · ${label(METHOD, payment.method)}${payment.reference ? ` · ${str(payment.reference)}` : ""}`, debit: 0, credit: num(payment.amount) });

  return withTenantContext(context, async (client) => {
    const periodText = from || to ? `Période du ${from ? pdfDate(from) : "début"} au ${to ? pdfDate(to) : pdfDate(new Date())}` : "Historique complet";
    const pdf = await createPdf(client, context.organizationId, { title: "Relevé client", reference: str(customer.code), subtitle: periodText });
    pdf.section("Client").fields([
      ["Client", customer.name],
      ["Type", label(CUSTOMER_TYPE, customer.customerType)],
      ["Contact", [str(customer.contactName), str(customer.phone), str(customer.email)].filter(Boolean).join(" · ")],
      ["Adresse", addressOf(customer)],
      ["Délai de paiement", `${num(customer.paymentTermsDays)} jours`],
      ["Statut", customer.isActive === false ? "Inactif" : "Actif"],
    ]);
    if (!byCurrency.size) pdf.section("Mouvements").paragraph("Aucune facture ni aucun paiement pour ce client.");
    for (const [currency, movements] of [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      movements.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.reference.localeCompare(b.reference) : a.kind === "invoice" ? -1 : 1));
      const opening = movements.filter((m) => from && m.date < from).reduce((sum, m) => sum + m.debit - m.credit, 0);
      const inPeriod = movements.filter((m) => (!from || m.date >= from) && (!to || m.date <= to));
      let running = opening;
      const rows: unknown[][] = [];
      if (from) rows.push([pdfDate(from), "", "Solde d'ouverture", "", "", pdfMoney(opening, currency)]);
      for (const movement of inPeriod) {
        running += movement.debit - movement.credit;
        rows.push([pdfDate(movement.date), movement.reference, movement.detail, movement.debit ? pdfMoney(movement.debit, currency) : "", movement.credit ? pdfMoney(movement.credit, currency) : "", pdfMoney(running, currency)]);
      }
      const debit = inPeriod.reduce((sum, m) => sum + m.debit, 0);
      const credit = inPeriod.reduce((sum, m) => sum + m.credit, 0);
      pdf.section(`Mouvements en ${currency}`);
      pdf.stats([["Facturé", pdfMoney(debit, currency)], ["Réglé", pdfMoney(credit, currency)], [running >= 0 ? "Solde dû" : "Avoir client", pdfMoney(Math.abs(running), currency)]]);
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Pièce", width: 1.5 }, { label: "Libellé", width: 2.4 }, { label: "Débit", width: 1.2, align: "right" }, { label: "Crédit", width: 1.2, align: "right" }, { label: "Solde", width: 1.3, align: "right" }],
        rows,
        { empty: "Aucun mouvement sur la période.", totals: ["Totaux", "", "", pdfMoney(debit, currency), pdfMoney(credit, currency), pdfMoney(running, currency)] },
      );
    }
    const open = detail.invoices.filter((invoice) => ["issued", "partially_paid", "overdue"].includes(str(invoice.status)) && num(invoice.total) - num(invoice.paidTotal) > 0.005);
    if (open.length) {
      const today = new Date().toISOString().slice(0, 10);
      pdf.section("Factures restant à payer");
      pdf.table(
        [{ label: "Facture", width: 1.5 }, { label: "Date", width: 1 }, { label: "Échéance", width: 1 }, { label: "Total", width: 1.3, align: "right" }, { label: "Réglé", width: 1.3, align: "right" }, { label: "Reste dû", width: 1.3, align: "right" }, { label: "Retard", width: 0.8, align: "right" }],
        open.map((invoice) => {
          const late = str(invoice.dueDate) && str(invoice.dueDate) < today ? Math.round((Date.parse(today) - Date.parse(str(invoice.dueDate))) / 86_400_000) : 0;
          return [invoice.invoiceNumber, pdfDate(invoice.invoiceDate), pdfDate(invoice.dueDate), pdfMoney(invoice.total, str(invoice.currency)), pdfMoney(invoice.paidTotal, str(invoice.currency)), pdfMoney(num(invoice.total) - num(invoice.paidTotal), str(invoice.currency)), late ? `${late} j` : "—"];
        }),
      );
    }
    pdf.note("Sauf erreur ou omission. Merci de nous signaler toute différence dans les 15 jours suivant la réception de ce relevé.");
    return { buffer: await pdf.finish(), fileName: `releve-${fileSafe(customer.code || customer.name)}.pdf` };
  });
}

/* ------------------------------------------------------------------ */
/* Rapport des ventes et dépenses                                       */
/* ------------------------------------------------------------------ */

function defaultPeriod(period: { from?: string; to?: string }) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const from = period.from ?? (period.to ? `${period.to.slice(0, 7)}-01` : first);
  const to = period.to ?? (period.from ? new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10) : last);
  if (to < from) throw new BadRequestError("End date cannot be before start date");
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw new BadRequestError("Choose a period of at most 13 months");
  return { from, to };
}

async function periodExpenses(context: SalesContext, from: string, to: string): Promise<Row[]> {
  const rows: Row[] = [];
  // Same loader and visibility rules as GET /owner-management/expenses.
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await listOwnerManagementRecords(context, "expenses", { fromDate: from, toDate: to, limit: 200, offset });
    rows.push(...page);
    if (page.length < 200) break;
  }
  return rows;
}

export async function salesReportPdf(context: SalesContext, period: { from?: string; to?: string }): Promise<PdfFile> {
  const { from, to } = defaultPeriod(period);
  // Expenses are only included for roles that can already read them.
  const canSeeExpenses = context.permissions.includes("finance.expenses.read");
  const expenses = canSeeExpenses ? await periodExpenses(context, from, to) : [];

  return withTenantContext(context, async (client) => {
    const visible = provinceGate(client, context);
    const [invoiceResult, paymentResult] = await Promise.all([
      client.query<Row>(
        `SELECT i.id, i.invoice_number, i.invoice_date::text AS invoice_day, i.status, i.currency, i.total, i.paid_total, i.province_id,
                c.name AS customer_name, c.province_id AS customer_province_id
           FROM sales_invoices i JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
          WHERE i.organization_id=$1 AND i.status<>'cancelled' AND i.invoice_date BETWEEN $2 AND $3
          ORDER BY i.invoice_date, i.invoice_number`,
        [context.organizationId, from, to],
      ),
      client.query<Row>(
        `SELECT p.payment_number, p.received_on::text AS received_day, p.method, p.currency, p.amount, c.name AS customer_name, c.province_id
           FROM customer_payments p JOIN customers c ON c.organization_id=p.organization_id AND c.id=p.customer_id
          WHERE p.organization_id=$1 AND p.received_on BETWEEN $2 AND $3
          ORDER BY p.received_on, p.payment_number`,
        [context.organizationId, from, to],
      ),
    ]);
    const invoices: Row[] = [];
    for (const row of invoiceResult.rows) if ((await visible(row.province_id)) && (await visible(row.customer_province_id))) invoices.push(row);
    const payments: Row[] = [];
    for (const row of paymentResult.rows) if (await visible(row.province_id)) payments.push(row);
    const productLines = invoices.length
      ? await client.query<Row>(
          `SELECT l.description, l.unit, i.currency, SUM(l.quantity) AS quantity, SUM(l.line_total) AS amount
             FROM sales_invoice_lines l JOIN sales_invoices i ON i.organization_id=l.organization_id AND i.id=l.invoice_id
            WHERE l.organization_id=$1 AND l.invoice_id = ANY($2::uuid[])
            GROUP BY l.description, l.unit, i.currency ORDER BY i.currency, SUM(l.line_total) DESC LIMIT 60`,
          [context.organizationId, invoices.map((row) => row.id)],
        )
      : { rows: [] as Row[] };

    type Totals = { invoiced: number; outstanding: number; received: number; expensesPaid: number; expensesCommitted: number };
    const totals = new Map<string, Totals>();
    const totalFor = (currency: unknown) => {
      const key = str(currency) || "CDF";
      if (!totals.has(key)) totals.set(key, { invoiced: 0, outstanding: 0, received: 0, expensesPaid: 0, expensesCommitted: 0 });
      return totals.get(key)!;
    };
    for (const invoice of invoices) {
      const current = totalFor(invoice.currency);
      current.invoiced += num(invoice.total);
      current.outstanding += Math.max(0, num(invoice.total) - num(invoice.paid_total));
    }
    for (const payment of payments) totalFor(payment.currency).received += num(payment.amount);
    for (const expense of expenses) {
      const status = str(expense.status);
      // A reimbursement brings money back: it reduces the expense total.
      const amount = num(expense.amount) * (str(expense.expenseType) === "reimbursement" ? -1 : 1);
      if (status === "paid") totalFor(expense.currencyCode).expensesPaid += amount;
      if (status === "paid" || status === "approved") totalFor(expense.currencyCode).expensesCommitted += amount;
    }

    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport des ventes et dépenses",
      subtitle: `Période du ${pdfDate(from)} au ${pdfDate(to)}`,
    });
    pdf.section("Synthèse par devise");
    const currencies = [...totals.keys()].sort();
    pdf.table(
      [
        { label: "Devise", width: 0.7 },
        { label: "Ventes facturées", width: 1.3, align: "right" },
        { label: "Encaissements", width: 1.3, align: "right" },
        { label: "Créances de la période", width: 1.3, align: "right" },
        ...(canSeeExpenses ? [{ label: "Dépenses payées", width: 1.3, align: "right" as const }, { label: "Trésorerie nette", width: 1.3, align: "right" as const }] : []),
      ],
      currencies.map((currency) => {
        const row = totals.get(currency)!;
        return [currency, pdfMoney(row.invoiced, currency), pdfMoney(row.received, currency), pdfMoney(row.outstanding, currency), ...(canSeeExpenses ? [pdfMoney(row.expensesPaid, currency), pdfMoney(row.received - row.expensesPaid, currency)] : [])];
      }),
      { empty: "Aucune vente, aucun encaissement ni aucune dépense sur la période." },
    );
    pdf.paragraph(
      `${invoices.length} facture(s) émise(s), ${payments.length} encaissement(s)${canSeeExpenses ? ` et ${expenses.length} dépense(s)` : ""} sur la période. La trésorerie nette correspond aux encaissements moins les dépenses payées.`,
      { size: 9, color: "#61708B" },
    );

    if (productLines.rows.length) {
      pdf.section("Ventes par produit");
      pdf.table(
        [{ label: "Produit", width: 3 }, { label: "Quantité", width: 1.2, align: "right" }, { label: "Unité", width: 0.8 }, { label: "Montant", width: 1.4, align: "right" }],
        productLines.rows.map((row) => [row.description, qty(row.quantity), row.unit, pdfMoney(row.amount, str(row.currency))]),
      );
    }

    pdf.section("Factures émises");
    pdf.table(
      [{ label: "Date", width: 0.9 }, { label: "Facture", width: 1.4 }, { label: "Client", width: 2 }, { label: "Statut", width: 1.2 }, { label: "Total", width: 1.3, align: "right" }, { label: "Reste dû", width: 1.3, align: "right" }],
      invoices.map((row) => [pdfDate(row.invoice_day), row.invoice_number, row.customer_name, label(INVOICE_STATUS, row.status), pdfMoney(row.total, str(row.currency)), pdfMoney(Math.max(0, num(row.total) - num(row.paid_total)), str(row.currency))]),
      { empty: "Aucune facture émise sur la période." },
    );

    pdf.section("Encaissements clients");
    pdf.table(
      [{ label: "Date", width: 0.9 }, { label: "Reçu", width: 1.4 }, { label: "Client", width: 2.2 }, { label: "Mode", width: 1.2 }, { label: "Montant", width: 1.3, align: "right" }],
      payments.map((row) => [pdfDate(row.received_day), row.payment_number, row.customer_name, label(METHOD, row.method), pdfMoney(row.amount, str(row.currency))]),
      { empty: "Aucun encaissement sur la période." },
    );

    if (canSeeExpenses) {
      const categories = new Map<string, { category: string; currency: string; count: number; committed: number; paid: number }>();
      for (const expense of expenses) {
        const status = str(expense.status);
        if (status !== "paid" && status !== "approved") continue;
        const category = str(expense.category) || str(expense.expenseType).replaceAll("_", " ") || "Autre";
        const currency = str(expense.currencyCode) || "CDF";
        const key = `${currency}:${category}`;
        const current = categories.get(key) ?? { category, currency, count: 0, committed: 0, paid: 0 };
        const amount = num(expense.amount) * (str(expense.expenseType) === "reimbursement" ? -1 : 1);
        current.count += 1;
        current.committed += amount;
        if (status === "paid") current.paid += amount;
        categories.set(key, current);
      }
      pdf.section("Dépenses par catégorie");
      pdf.table(
        [{ label: "Catégorie", width: 2.4 }, { label: "Devise", width: 0.7 }, { label: "Nombre", width: 0.8, align: "right" }, { label: "Approuvées et payées", width: 1.5, align: "right" }, { label: "Dont payées", width: 1.4, align: "right" }],
        [...categories.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.committed - a.committed).map((row) => [row.category, row.currency, row.count, pdfMoney(row.committed, str(row.currency)), pdfMoney(row.paid, str(row.currency))]),
        { empty: "Aucune dépense approuvée ou payée sur la période." },
      );
      pdf.section("Détail des dépenses");
      pdf.table(
        [{ label: "Date", width: 0.9 }, { label: "N°", width: 1.2 }, { label: "Libellé", width: 2.4 }, { label: "Bénéficiaire", width: 1.4 }, { label: "Statut", width: 1 }, { label: "Montant", width: 1.3, align: "right" }],
        [...expenses]
          .sort((a, b) => str(a.expenseDate).localeCompare(str(b.expenseDate)))
          .map((row) => [pdfDate(row.expenseDate), row.expenseNumber, row.title || row.description, row.beneficiaryName, label(EXPENSE_STATUS, row.status), pdfMoney(row.amount, str(row.currencyCode))]),
        { empty: "Aucune dépense sur la période." },
      );
    } else {
      pdf.note("Les dépenses ne figurent pas dans ce rapport : votre rôle ne donne pas accès aux dépenses.");
    }
    pdf.signatures(["Établi par", "Vérifié par (responsable financier)"]);
    return { buffer: await pdf.finish(), fileName: `rapport-ventes-depenses-${from}-${to}.pdf` };
  });
}
