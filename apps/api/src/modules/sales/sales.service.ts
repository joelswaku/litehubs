import type { PoolClient } from "pg";
import { sendMail, sendSms } from "../../services/notification.service";
import { withTenantContext } from "../../utils/tenant-query";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import type { CreateOrderInput, CustomerInput, CustomerUpdateInput, DeliveryInput, OfferInput, PaymentInput, SalesListQuery } from "./sales.validation";

export interface SalesContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Row = Record<string, unknown>;
type SourceType = "egg_flock" | "poultry_flock" | "pig_group" | "pig_animal" | "harvest_planting" | "inventory_item";

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
const mapRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value instanceof Date ? value.toISOString().slice(0, key.endsWith("_at") ? undefined : 10) : value]));
const number = (value: unknown) => Number(value ?? 0);
const decimal = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const today = () => new Date().toISOString().slice(0, 10);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const pageWindow = (query: Pick<SalesListQuery, "page" | "limit">) => {
  const requestedLimit = Number(query.limit);
  const requestedPage = Number(query.page);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const page = Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1;
  return { limit, offset: (page - 1) * limit };
};
const nullableText = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized || null;
};

async function maySeeProvince(client: PoolClient, context: SalesContext, provinceId: string | null): Promise<boolean> {
  if (context.isOwner || !provinceId) return true;
  if (!isUuid(context.memberId)) return false;
  if (!isUuid(provinceId)) {
    // Some legacy rows stored a province label instead of its UUID. They have no
    // reliable province scope, but organization-wide roles may still read them.
    // Province-limited members never receive those ambiguous rows.
    const scope = await client.query<{ organization_scope: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM member_roles mr
         JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
         WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization'
       ) AS organization_scope`,
      [context.organizationId, context.memberId],
    );
    return Boolean(scope.rows[0]?.organization_scope);
  }
  const scope = await client.query<{ organization_scope: boolean; allowed: boolean }>(
    `SELECT
       EXISTS(SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization') AS organization_scope,
       EXISTS(SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3) AS allowed`,
    [context.organizationId, context.memberId, provinceId],
  );
  return Boolean(scope.rows[0]?.organization_scope || scope.rows[0]?.allowed);
}
async function assertProvinceScope(client: PoolClient, context: SalesContext, provinceId: string | null) {
  if (!(await maySeeProvince(client, context, provinceId)))
    throw new ForbiddenError("You are not allowed to work with sales records in this province");
}

async function source(client: PoolClient, context: SalesContext, sourceType: SourceType, sourceId: string): Promise<Row> {
  const queries: Record<SourceType, { sql: string; unit: string }> = {
    egg_flock: {
      unit: "egg",
      sql: `SELECT f.id, f.name || ' · eggs' AS title, s.province_id, s.id AS site_id
            FROM poultry_flocks f
            JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id
            JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
            WHERE f.organization_id=$1 AND f.id=$2 AND COALESCE(f.production_type,f.bird_type) IN ('layer','breeder')`,
    },
    poultry_flock: {
      unit: "bird",
      sql: `SELECT f.id, f.name || ' · live birds' AS title, s.province_id, s.id AS site_id
            FROM poultry_flocks f
            JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id
            JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
            WHERE f.organization_id=$1 AND f.id=$2 AND f.status='ready_for_sale'`,
    },
    pig_group: {
      unit: "kg",
      sql: `SELECT g.id, g.name || ' · pork' AS title, s.province_id, s.id AS site_id
            FROM pig_groups g JOIN pig_pens pen ON pen.organization_id=g.organization_id AND pen.id=g.pen_id
            JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
            WHERE g.organization_id=$1 AND g.id=$2 AND g.status='active'`,
    },
    pig_animal: {
      unit: "kg",
      sql: `SELECT a.id, COALESCE(a.name,a.animal_number) || ' · pork' AS title, s.province_id, s.id AS site_id
            FROM pig_animals a JOIN pig_pens pen ON pen.organization_id=a.organization_id AND pen.id=a.pen_id
            JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
            WHERE a.organization_id=$1 AND a.id=$2 AND a.status='active' AND a.group_id IS NULL`,
    },
    harvest_planting: {
      unit: "kg",
      sql: `SELECT p.id, p.name || ' · harvest' AS title, s.province_id, s.id AS site_id
            FROM agriculture_plantings p
            JOIN agriculture_plots plot ON plot.organization_id=p.organization_id AND plot.id=p.plot_id
            JOIN agriculture_fields field ON field.organization_id=plot.organization_id AND field.id=plot.field_id
            JOIN agriculture_farms farm ON farm.organization_id=field.organization_id AND farm.id=field.farm_id
            JOIN sites s ON s.organization_id=farm.organization_id AND s.id=farm.site_id
            WHERE p.organization_id=$1 AND p.id=$2 AND p.status NOT IN ('failed','abandoned','closed')`,
    },
    inventory_item: {
      unit: "unit",
      sql: `SELECT i.id, i.name AS title, NULL::uuid AS province_id, NULL::uuid AS site_id, i.unit
            FROM management_inventory_items i WHERE i.organization_id=$1 AND i.id=$2 AND i.is_active`,
    },
  };
  const result = await client.query<Row>(queries[sourceType].sql, [context.organizationId, sourceId]);
  if (!result.rowCount) throw new NotFoundError("The operational record is not available for sale");
  return { ...result.rows[0]!, unit: result.rows[0]!.unit ?? queries[sourceType].unit };
}

async function deliveredForOffer(client: PoolClient, context: SalesContext, offerId: string): Promise<number> {
  const result = await client.query<{ quantity: string }>(
    `SELECT COALESCE(SUM(dl.quantity),0) AS quantity
       FROM sales_delivery_lines dl
       JOIN sales_deliveries d ON d.organization_id=dl.organization_id AND d.id=dl.delivery_id AND d.status='delivered'
       JOIN sales_order_lines ol ON ol.organization_id=dl.organization_id AND ol.id=dl.order_line_id
      WHERE dl.organization_id=$1 AND ol.operational_offer_id=$2`,
    [context.organizationId, offerId],
  );
  return number(result.rows[0]?.quantity);
}

async function sourceQuantity(client: PoolClient, context: SalesContext, offer: Row): Promise<number> {
  const sourceType = String(offer.source_type) as SourceType;
  const sourceId = String(offer.source_id);
  const queries: Record<SourceType, string> = {
    egg_flock: `SELECT COALESCE(SUM(total_eggs-cracked_eggs-dirty_eggs-hatching_eggs-rejected_eggs),0) AS quantity FROM poultry_egg_records WHERE organization_id=$1 AND flock_id=$2`,
    poultry_flock: `SELECT COALESCE((SELECT live_bird_count FROM poultry_daily_records WHERE organization_id=$1 AND flock_id=$2 ORDER BY record_date DESC, created_at DESC LIMIT 1),(SELECT initial_bird_count FROM poultry_flocks WHERE organization_id=$1 AND id=$2),0) AS quantity`,
    pig_group: `SELECT COALESCE((SELECT closing_count FROM pig_daily_records WHERE organization_id=$1 AND group_id=$2 AND closing_count IS NOT NULL ORDER BY record_date DESC,created_at DESC LIMIT 1),(SELECT initial_count FROM pig_groups WHERE organization_id=$1 AND id=$2),0) * COALESCE((SELECT average_weight_kg FROM pig_weight_records WHERE organization_id=$1 AND group_id=$2 ORDER BY record_date DESC,created_at DESC LIMIT 1),0) AS quantity`,
    pig_animal: `SELECT COALESCE((SELECT average_weight_kg FROM pig_weight_records WHERE organization_id=$1 AND animal_id=$2 ORDER BY record_date DESC,created_at DESC LIMIT 1),0) AS quantity`,
    harvest_planting: `SELECT GREATEST(COALESCE((SELECT SUM(h.quantity-h.rejected_quantity) FROM agriculture_harvest_records h WHERE h.organization_id=$1 AND h.planting_id=$2 AND lower(COALESCE(h.unit,'kg'))='kg'),0) - COALESCE((SELECT SUM(input.quantity_kg) FROM management_feed_batch_inputs input JOIN management_feed_batches batch ON batch.organization_id=input.organization_id AND batch.id=input.batch_id WHERE input.organization_id=$1 AND input.source_type='harvest' AND input.harvest_record_id IN (SELECT id FROM agriculture_harvest_records WHERE organization_id=$1 AND planting_id=$2) AND batch.status='confirmed' AND batch.stock_applied_at IS NOT NULL),0),0) AS quantity`,
    inventory_item: `SELECT COALESCE(SUM(quantity_on_hand-quantity_reserved),0) AS quantity FROM management_inventory_stock WHERE organization_id=$1 AND item_id=$2`,
  };
  const result = await client.query<{ quantity: string }>(queries[sourceType], [context.organizationId, sourceId]);
  return number(result.rows[0]?.quantity);
}

async function offerWithAvailability(client: PoolClient, context: SalesContext, row: Row): Promise<Row> {
  const physical = await sourceQuantity(client, context, row);
  const delivered = await deliveredForOffer(client, context, String(row.id));
  const available = Math.max(0, decimal(physical - delivered));
  return mapRow({ ...row, physical_quantity: physical, delivered_quantity: delivered, available_quantity: available, sale_ready: Boolean(row.is_available) && available >= number(row.minimum_quantity) });
}

async function assertOfferAvailable(client: PoolClient, context: SalesContext, offerId: string, requested: number): Promise<Row> {
  const found = await client.query<Row>("SELECT * FROM sales_operational_offers WHERE organization_id=$1 AND id=$2 FOR UPDATE", [context.organizationId, offerId]);
  if (!found.rowCount) throw new NotFoundError("Sellable product not found");
  const offer = found.rows[0]!;
  await assertProvinceScope(client, context, offer.province_id as string | null);
  if (!offer.is_available) throw new BadRequestError("This product is not available for sale");
  if (offer.source_type === "egg_flock" || offer.source_type === "poultry_flock") {
    // Food safety: birds and eggs cannot be sold before the withdrawal period
    // (délai d'attente) of a treatment has ended.
    const withdrawal = await client.query<{ product_name: string; until: string }>(
      "SELECT product_name, withdrawal_end_date::text AS until FROM poultry_treatment_records WHERE organization_id=$1 AND flock_id=$2 AND withdrawal_end_date >= CURRENT_DATE ORDER BY withdrawal_end_date DESC LIMIT 1",
      [context.organizationId, offer.source_id],
    );
    const active = withdrawal.rows[0];
    if (active)
      throw new BadRequestError(`This flock is under a treatment withdrawal period (${active.product_name}) until ${active.until}; it cannot be sold before then`);
  }
  const availability = await offerWithAvailability(client, context, offer);
  if (requested > number(availability.availableQuantity) + 0.00001)
    throw new BadRequestError(`Only ${availability.availableQuantity} ${offer.unit} is available to sell`);
  return offer;
}

function lineTotal(quantity: number, unitPrice: number, discountPercent: number, taxPercent: number) {
  const beforeTax = quantity * unitPrice * (1 - discountPercent / 100);
  return { subtotal: beforeTax, tax: beforeTax * taxPercent / 100, total: beforeTax * (1 + taxPercent / 100) };
}

function generated(prefix: string) { return `${prefix}-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; }
type InvoiceNotice = { email: string | null; phone: string | null; companyName: string; customerName: string; invoiceNumber: string; invoiceDate: string; dueDate: string; currency: string; total: number; lines: Array<{ description: string; quantity: number; unit: string; lineTotal: number }> };
const escapeInvoiceHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const invoiceMoney = (value: number, currency: string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

async function sendIssuedInvoiceNotice(invoice: InvoiceNotice): Promise<void> {
  const amount = invoiceMoney(invoice.total, invoice.currency);
  const sms = `Bonjour ${invoice.customerName}, votre facture ${invoice.invoiceNumber} de ${amount} est disponible. Échéance : ${invoice.dueDate}. — ${invoice.companyName}`;
  if (invoice.email) {
    const lines = invoice.lines.map((line) => `<tr><td style="padding:9px 0;border-bottom:1px solid #eaecf0;">${escapeInvoiceHtml(line.description)}</td><td style="padding:9px 0;border-bottom:1px solid #eaecf0;text-align:right;">${line.quantity} ${escapeInvoiceHtml(line.unit)}</td><td style="padding:9px 0;border-bottom:1px solid #eaecf0;text-align:right;">${escapeInvoiceHtml(invoiceMoney(line.lineTotal, invoice.currency))}</td></tr>`).join("");
    await sendMail({ to: invoice.email, subject: `Facture ${invoice.invoiceNumber} · ${invoice.companyName}`, text: `${sms}\n\nDétail :\n${invoice.lines.map((line) => `- ${line.description} : ${line.quantity} ${line.unit} — ${invoiceMoney(line.lineTotal, invoice.currency)}`).join("\n")}`, html: `<div style="max-width:640px;margin:0 auto;padding:28px;font-family:Arial,sans-serif;color:#101828;"><p style="margin:0 0 18px;color:#0f5132;font-size:20px;font-weight:700;">${escapeInvoiceHtml(invoice.companyName)}</p><h1 style="margin:0 0 8px;font-size:24px;">Facture ${escapeInvoiceHtml(invoice.invoiceNumber)}</h1><p style="margin:0 0 22px;color:#475467;line-height:1.6;">Bonjour ${escapeInvoiceHtml(invoice.customerName)}, votre facture est disponible.</p><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="color:#667085;text-align:left;"><th style="padding-bottom:9px;">Description</th><th style="padding-bottom:9px;text-align:right;">Quantité</th><th style="padding-bottom:9px;text-align:right;">Total</th></tr></thead><tbody>${lines}</tbody></table><div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:10px;"><strong>Total à payer : ${escapeInvoiceHtml(amount)}</strong><br/><span style="color:#475467;font-size:13px;">Échéance : ${escapeInvoiceHtml(invoice.dueDate)}</span></div></div>` });
    return;
  }
  if (invoice.phone) await sendSms({ to: invoice.phone, content: sms });
}

export async function listCustomers(context: SalesContext, query: SalesListQuery) {
  return withTenantContext(context, async (client) => {
    if (context.isOwner) {
      const result = await client.query<Row>(
        "SELECT * FROM customers WHERE organization_id=$1 ORDER BY is_active DESC,name LIMIT 100",
        [context.organizationId],
      );
      return result.rows.map(mapRow);
    }
    const { limit, offset } = pageWindow(query);
    const args: unknown[] = [context.organizationId];
    const terms = ["organization_id=$1"];
    if (query.provinceId) { args.push(query.provinceId); terms.push(`province_id=$${args.length}`); }
    if (query.search) { args.push(`%${query.search}%`); terms.push(`(name ILIKE $${args.length} OR code ILIKE $${args.length})`); }
    args.push(limit, offset);
    let rows: Row[];
    try {
      const result = await client.query<Row>(
        `SELECT * FROM customers WHERE ${terms.join(" AND ")} ORDER BY is_active DESC,name LIMIT ${args.length - 1} OFFSET ${args.length}`,
        args,
      );
      rows = result.rows;
    } catch (error: unknown) {
      // A legacy filter value must not make the whole customer register unusable.
      // The fallback retains the organization boundary and is deliberately capped.
      if ((error as { code?: string } | undefined)?.code !== "22P02") throw error;
      const result = await client.query<Row>(
        "SELECT * FROM customers WHERE organization_id=$1 ORDER BY is_active DESC,name LIMIT 100",
        [context.organizationId],
      );
      rows = result.rows;
    }
    const visible: Row[] = [];
    for (const row of rows) {
      if (context.isOwner) { visible.push(mapRow(row)); continue; }
      try {
        if (await maySeeProvince(client, context, row.province_id as string | null)) visible.push(mapRow(row));
      } catch (error: unknown) {
        // Do not expose an ambiguous legacy record to a province-limited role.
        // Other valid customer records remain visible.
        if ((error as { code?: string } | undefined)?.code !== "22P02") throw error;
      }
    }
    return visible;
  });
}
async function nextCustomerCode(client: PoolClient, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `customer-reference:${organizationId}`,
  ]);
  const result = await client.query<{ next_code: number | string }>(
    `SELECT COALESCE(
       MAX(((regexp_match(code, '^CLI-([0-9]+)$'))[1])::integer),
       0
     ) + 1 AS next_code
     FROM customers
     WHERE organization_id=$1`,
    [organizationId],
  );
  return `CLI-${String(Number(result.rows[0]?.next_code ?? 1)).padStart(6, "0")}`;
}

export async function createCustomer(context: SalesContext, input: CustomerInput) {
  return withTenantContext(context, async (client) => {
    await assertProvinceScope(client, context, input.provinceId ?? null);
    const customerCode = input.code ?? await nextCustomerCode(client, context.organizationId);
    try {
      const result = await client.query<Row>(
        `INSERT INTO customers (organization_id,code,name,customer_type,contact_name,phone,email,address_line1,address_line2,city,region,postal_code,country,currency,payment_terms_days,credit_limit,province_id,is_active,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [
          context.organizationId, customerCode, input.name, input.customerType ?? "business",
          nullableText(input.contactName), nullableText(input.phone), nullableText(input.email),
          nullableText(input.addressLine1), nullableText(input.addressLine2), nullableText(input.city),
          nullableText(input.region), nullableText(input.postalCode), nullableText(input.country),
          input.currency ?? null, input.paymentTermsDays ?? 0, input.creditLimit ?? null,
          input.provinceId ?? null, input.isActive ?? true, nullableText(input.notes), context.userId,
        ],
      );
      return mapRow(result.rows[0]!);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") throw new ConflictError("A customer with that code already exists");
      throw error;
    }
  });
}

export async function updateCustomer(context: SalesContext, customerId: string, input: CustomerUpdateInput) {
  return withTenantContext(context, async (client) => {
    const existing = await client.query<{ province_id: string | null }>(
      "SELECT province_id FROM customers WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [context.organizationId, customerId],
    );
    if (!existing.rowCount) throw new NotFoundError("Customer not found");
    await assertProvinceScope(client, context, existing.rows[0]!.province_id);
    const changes: Array<[string, unknown]> = [];
    if (input.name !== undefined) changes.push(["name", input.name]);
    if (input.customerType !== undefined) changes.push(["customer_type", input.customerType]);
    if (input.contactName !== undefined) changes.push(["contact_name", input.contactName]);
    if (input.phone !== undefined) changes.push(["phone", input.phone]);
    if (input.email !== undefined) changes.push(["email", input.email]);
    if (input.addressLine1 !== undefined) changes.push(["address_line1", input.addressLine1]);
    if (input.addressLine2 !== undefined) changes.push(["address_line2", input.addressLine2]);
    if (input.city !== undefined) changes.push(["city", input.city]);
    if (input.region !== undefined) changes.push(["region", input.region]);
    if (input.postalCode !== undefined) changes.push(["postal_code", input.postalCode]);
    if (input.country !== undefined) changes.push(["country", input.country]);
    if (input.paymentTermsDays !== undefined) changes.push(["payment_terms_days", input.paymentTermsDays]);
    if (input.isActive !== undefined) changes.push(["is_active", input.isActive]);
    if (input.notes !== undefined) changes.push(["notes", input.notes]);
    if (!changes.length) throw new BadRequestError("Provide at least one customer change");
    const result = await client.query<Row>(
      `UPDATE customers
       SET ${changes.map(([column], index) => `${column}=$${index + 1}`).join(", ")}
       WHERE organization_id=$${changes.length + 1} AND id=$${changes.length + 2}
       RETURNING *`,
      [...changes.map(([, value]) => value), context.organizationId, customerId],
    );
    return mapRow(result.rows[0]!);
  });
}

export async function customerDetail(context: SalesContext, customerId: string) {
  return withTenantContext(context, async (client) => {
    const customerResult = await client.query<Row>(
      "SELECT * FROM customers WHERE organization_id=$1 AND id=$2",
      [context.organizationId, customerId],
    );
    if (!customerResult.rowCount) throw new NotFoundError("Customer not found");
    const customer = customerResult.rows[0]!;
    await assertProvinceScope(client, context, customer.province_id as string | null);
    const [orders, invoices, payments] = await Promise.all([
      client.query<Row>(`SELECT id,order_number,order_date,required_date,status,currency,total,created_at
                           FROM sales_orders WHERE organization_id=$1 AND customer_id=$2
                           ORDER BY order_date DESC,created_at DESC`, [context.organizationId, customerId]),
      client.query<Row>(`SELECT id,invoice_number,invoice_date,due_date,status,currency,total,paid_total,created_at
                           FROM sales_invoices WHERE organization_id=$1 AND customer_id=$2
                           ORDER BY invoice_date DESC,created_at DESC`, [context.organizationId, customerId]),
      client.query<Row>(`SELECT id,payment_number,received_on,method,currency,amount,reference,created_at
                           FROM customer_payments WHERE organization_id=$1 AND customer_id=$2
                           ORDER BY received_on DESC,created_at DESC`, [context.organizationId, customerId]),
    ]);
    const totals = new Map<string, { currency: string; ordersTotal: number; invoicedTotal: number; paidTotal: number; outstanding: number; receiptsTotal: number }>();
    const totalFor = (currencyValue: unknown) => {
      const currencyCode = String(currencyValue || "CDF");
      const current = totals.get(currencyCode) ?? { currency: currencyCode, ordersTotal: 0, invoicedTotal: 0, paidTotal: 0, outstanding: 0, receiptsTotal: 0 };
      totals.set(currencyCode, current);
      return current;
    };
    for (const order of orders.rows) if (String(order.status) !== "cancelled") totalFor(order.currency).ordersTotal += number(order.total);
    for (const invoice of invoices.rows) if (String(invoice.status) !== "cancelled") {
      const current = totalFor(invoice.currency);
      const paid = number(invoice.paid_total);
      current.invoicedTotal += number(invoice.total);
      current.paidTotal += paid;
      current.outstanding += Math.max(0, number(invoice.total) - paid);
    }
    for (const payment of payments.rows) totalFor(payment.currency).receiptsTotal += number(payment.amount);
    return { customer: mapRow(customer), orders: orders.rows.map(mapRow), invoices: invoices.rows.map(mapRow), payments: payments.rows.map(mapRow), summary: [...totals.values()].map((row) => ({ ...row, ordersTotal: decimal(row.ordersTotal), invoicedTotal: decimal(row.invoicedTotal), paidTotal: decimal(row.paidTotal), outstanding: decimal(row.outstanding), receiptsTotal: decimal(row.receiptsTotal) })) };
  });
}

export async function listSellableSources(context: SalesContext) {
  return withTenantContext(context, async (client) => {
    const rows: Row[] = [];
    const queries: Array<{ sourceType: SourceType; sql: string; unit: string }> = [
      { sourceType:"egg_flock", unit:"egg", sql:`SELECT f.id,f.name || ' · eggs' AS title,s.province_id,s.id AS site_id FROM poultry_flocks f JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id WHERE f.organization_id=$1 AND COALESCE(f.production_type,f.bird_type) IN ('layer','breeder') AND f.status IN ('active','ready_for_sale')` },
      { sourceType:"poultry_flock", unit:"bird", sql:`SELECT f.id,f.name || ' · live birds' AS title,s.province_id,s.id AS site_id,(f.status='ready_for_sale') AS sale_eligible FROM poultry_flocks f JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id WHERE f.organization_id=$1 AND f.status IN ('active','ready_for_sale')` },
      { sourceType:"pig_group", unit:"kg", sql:`SELECT g.id,g.name || ' · pork' AS title,s.province_id,s.id AS site_id FROM pig_groups g JOIN pig_pens pen ON pen.organization_id=g.organization_id AND pen.id=g.pen_id JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id WHERE g.organization_id=$1 AND g.status='active'` },
      { sourceType:"pig_animal", unit:"kg", sql:`SELECT a.id,COALESCE(a.name,a.animal_number) || ' · pork' AS title,s.province_id,s.id AS site_id FROM pig_animals a JOIN pig_pens pen ON pen.organization_id=a.organization_id AND pen.id=a.pen_id JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id WHERE a.organization_id=$1 AND a.status='active'` },
      { sourceType:"harvest_planting", unit:"kg", sql:`SELECT p.id,p.name || ' · harvest' AS title,s.province_id,s.id AS site_id FROM agriculture_plantings p JOIN agriculture_plots plot ON plot.organization_id=p.organization_id AND plot.id=p.plot_id JOIN agriculture_fields field ON field.organization_id=plot.organization_id AND field.id=plot.field_id JOIN agriculture_farms farm ON farm.organization_id=field.organization_id AND farm.id=field.farm_id JOIN sites s ON s.organization_id=farm.organization_id AND s.id=farm.site_id WHERE p.organization_id=$1 AND p.status NOT IN ('failed','abandoned','closed')` },
      { sourceType:"inventory_item", unit:"unit", sql:`SELECT i.id,i.name AS title,NULL::uuid AS province_id,NULL::uuid AS site_id,i.unit FROM management_inventory_items i WHERE i.organization_id=$1 AND i.is_active` },
    ];
    for (const query of queries) {
      const result = await client.query<Row>(query.sql, [context.organizationId]);
      for (const row of result.rows) {
        if (await maySeeProvince(client, context, row.province_id as string | null)) {
          const sourceRow = { ...row, source_type: query.sourceType, source_id: row.id, unit: row.unit ?? query.unit, sale_eligible: row.sale_eligible ?? true };
          const physicalQuantity = await sourceQuantity(client, context, sourceRow);
          rows.push(mapRow({ ...sourceRow, physical_quantity: physicalQuantity }));
        }
      }
    }
    return rows;
  });
}

export async function listSalesWarehouses(context:SalesContext){return withTenantContext(context,async client=>{
  const result=await client.query<Row>(`SELECT w.*,s.name AS site_name,s.province_id,p.name AS province_name FROM management_warehouses w JOIN sites s ON s.organization_id=w.organization_id AND s.id=w.site_id JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id WHERE w.organization_id=$1 AND w.is_active ORDER BY w.name`,[context.organizationId]);
  const visible:Row[]=[];for(const row of result.rows)if(await maySeeProvince(client,context,row.province_id as string|null))visible.push(mapRow(row));return visible;
});}
export async function listOffers(context: SalesContext, query: SalesListQuery) {
  return withTenantContext(context, async (client) => {
    const args: unknown[] = [context.organizationId]; const terms = ["organization_id=$1"];
    if (query.provinceId) { args.push(query.provinceId); terms.push(`province_id=$${args.length}`); }
    if (query.siteId) { args.push(query.siteId); terms.push(`site_id=$${args.length}`); }
    if (query.search) { args.push(`%${query.search}%`); terms.push(`(title ILIKE $${args.length} OR code ILIKE $${args.length})`); }
    const result = await client.query<Row>(`SELECT * FROM sales_operational_offers WHERE ${terms.join(" AND ")} ORDER BY is_available DESC,title`, args);
    const visible: Row[] = [];
    for (const row of result.rows) if (await maySeeProvince(client, context, row.province_id as string | null)) visible.push(await offerWithAvailability(client, context, row));
    return visible;
  });
}

export async function productionSummary(context: SalesContext) {
  const [sources, offers] = await Promise.all([
    listSellableSources(context),
    listOffers(context, { page: 1, limit: 100 }),
  ]);
  const categoryBySource: Record<SourceType, { type: string; unit: string }> = {
    egg_flock: { type: "eggs", unit: "egg" },
    poultry_flock: { type: "poultry", unit: "bird" },
    pig_group: { type: "pork", unit: "kg" },
    pig_animal: { type: "pork", unit: "kg" },
    harvest_planting: { type: "harvest", unit: "kg" },
    inventory_item: { type: "inventory", unit: "unit" },
  };
  const connected = new Map(
    offers.map((offer) => [
      `${String(offer.sourceType)}:${String(offer.sourceId)}`,
      offer,
    ]),
  );
  const totals = new Map<string, Row>();
  for (const source of sources) {
    const sourceType = String(source.sourceType) as SourceType;
    const category = categoryBySource[sourceType];
    const current = totals.get(category.type) ?? {
      type: category.type,
      unit: category.unit,
      production_quantity: 0,
      available_quantity: 0,
      source_count: 0,
      connected_count: 0,
    };
    const linkedOffer = connected.get(`${sourceType}:${String(source.id)}`);
    current.production_quantity = decimal(number(current.production_quantity) + number(source.physicalQuantity));
    current.available_quantity = decimal(number(current.available_quantity) + (linkedOffer ? number(linkedOffer.availableQuantity) : 0));
    current.source_count = number(current.source_count) + 1;
    current.connected_count = number(current.connected_count) + (linkedOffer ? 1 : 0);
    totals.set(category.type, current);
  }
  return ["eggs", "poultry", "pork", "harvest", "inventory"].map((type) =>
    mapRow(totals.get(type) ?? {
      type,
      unit: type === "eggs" ? "egg" : type === "poultry" ? "bird" : type === "pork" || type === "harvest" ? "kg" : "unit",
      production_quantity: 0,
      available_quantity: 0,
      source_count: 0,
      connected_count: 0,
    }),
  );
}
export async function createOffer(context: SalesContext, input: OfferInput) {
  return withTenantContext(context, async (client) => {
    const linked = await source(client, context, input.sourceType, input.sourceId);
    await assertProvinceScope(client, context, linked.province_id as string | null);
    try {
      const inserted = await client.query<Row>(
        `INSERT INTO sales_operational_offers (organization_id,code,title,source_type,source_id,province_id,site_id,unit,default_unit_price,currency,minimum_quantity,is_available,ecommerce_status,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [context.organizationId,input.code,input.title ?? linked.title,input.sourceType,input.sourceId,linked.province_id??null,linked.site_id??null,linked.unit,input.defaultUnitPrice??null,input.currency??null,input.minimumQuantity,input.isAvailable,input.ecommerceStatus,input.notes??null,context.userId],
      );
      return offerWithAvailability(client, context, inserted.rows[0]!);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") throw new ConflictError("This operational source already has a sales offer or the code is already used");
      throw error;
    }
  });
}

export async function createOrder(context: SalesContext, input: CreateOrderInput) {
  return withTenantContext(context, async (client) => {
    await assertProvinceScope(client, context, input.provinceId ?? null);
    if (input.siteId) {
      const site = await client.query<{ province_id:string }>("SELECT province_id FROM sites WHERE organization_id=$1 AND id=$2",[context.organizationId,input.siteId]);
      if (!site.rowCount) throw new NotFoundError("Site not found");
      if (input.provinceId && site.rows[0]!.province_id !== input.provinceId) throw new BadRequestError("The site does not belong to the selected province");
      await assertProvinceScope(client,context,site.rows[0]!.province_id);
    }
    const customer = await client.query<{ province_id:string|null }>("SELECT province_id FROM customers WHERE organization_id=$1 AND id=$2 AND is_active",[context.organizationId,input.customerId]);
    if (!customer.rowCount) throw new NotFoundError("Active customer not found");
    await assertProvinceScope(client,context,customer.rows[0]!.province_id);
    const calculated = input.lines.map((line)=>({ ...line, totals:lineTotal(line.quantity,line.unitPrice,line.discountPercent,line.taxPercent) }));
    const subtotal = calculated.reduce((sum,line)=>sum+line.totals.subtotal,0); const tax = calculated.reduce((sum,line)=>sum+line.totals.tax,0); const total=subtotal+tax;
    const order = await client.query<Row>(
      `INSERT INTO sales_orders (organization_id,customer_id,province_id,site_id,order_number,order_date,required_date,currency,subtotal,tax_total,total,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [context.organizationId,input.customerId,input.provinceId??null,input.siteId??null,input.orderNumber??generated("SO"),input.orderDate,input.requiredDate??null,input.currency,subtotal,tax,total,input.notes??null,context.userId],
    );
    for (const [index,line] of calculated.entries()) {
      if (line.offerId) {
        const offer=await assertOfferAvailable(client,context,line.offerId,line.quantity);
        if (String(offer.unit)!==line.unit) throw new BadRequestError(`Use ${offer.unit} for this sellable product`);
      }
      await client.query(
        `INSERT INTO sales_order_lines (organization_id,order_id,line_number,item_id,operational_offer_id,description,quantity,unit,unit_price,discount_percent,tax_percent,line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [context.organizationId,order.rows[0]!.id,index+1,line.itemId??null,line.offerId??null,line.description,line.quantity,line.unit,line.unitPrice,line.discountPercent,line.taxPercent,line.totals.total],
      );
    }
    return getOrderInTransaction(client,context,String(order.rows[0]!.id));
  });
}

async function getOrderInTransaction(client: PoolClient, context: SalesContext, orderId:string): Promise<Row & { lines: Row[] }> {
  const order=await client.query<Row>(`SELECT o.*,c.name AS customer_name,p.name AS province_name,s.name AS site_name FROM sales_orders o JOIN customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id LEFT JOIN provinces p ON p.organization_id=o.organization_id AND p.id=o.province_id LEFT JOIN sites s ON s.organization_id=o.organization_id AND s.id=o.site_id WHERE o.organization_id=$1 AND o.id=$2`,[context.organizationId,orderId]);
  if(!order.rowCount) throw new NotFoundError("Sales order not found");
  await assertProvinceScope(client,context,order.rows[0]!.province_id as string|null);
  const lines=await client.query<Row>("SELECT ol.*,so.title AS offer_title FROM sales_order_lines ol LEFT JOIN sales_operational_offers so ON so.organization_id=ol.organization_id AND so.id=ol.operational_offer_id WHERE ol.organization_id=$1 AND ol.order_id=$2 ORDER BY ol.line_number",[context.organizationId,orderId]);
  return {...mapRow(order.rows[0]!),lines:lines.rows.map(mapRow)};
}

export async function listOrders(context: SalesContext, query: SalesListQuery) {
  return withTenantContext(context,async client=>{
    const { limit, offset } = pageWindow(query);
    const args:unknown[]=[context.organizationId]; const terms=["o.organization_id=$1"];
    if(query.status){args.push(query.status);terms.push(`o.status=$${args.length}`);} if(query.provinceId){args.push(query.provinceId);terms.push(`o.province_id=$${args.length}`);} if(query.search){args.push(`%${query.search}%`);terms.push(`(o.order_number ILIKE $${args.length} OR c.name ILIKE $${args.length})`);} args.push(limit,offset);
    const result=await client.query<Row>(`SELECT o.*,c.name AS customer_name,p.name AS province_name,s.name AS site_name FROM sales_orders o JOIN customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id LEFT JOIN provinces p ON p.organization_id=o.organization_id AND p.id=o.province_id LEFT JOIN sites s ON s.organization_id=o.organization_id AND s.id=o.site_id WHERE ${terms.join(" AND ")} ORDER BY o.order_date DESC,o.created_at DESC LIMIT $${args.length-1} OFFSET $${args.length}`,args);
    const orderIds=result.rows.map(row=>String(row.id)); const lineRows=orderIds.length?await client.query<Row>(`SELECT ol.*,so.source_type AS offer_source_type FROM sales_order_lines ol LEFT JOIN sales_operational_offers so ON so.organization_id=ol.organization_id AND so.id=ol.operational_offer_id WHERE ol.organization_id=$1 AND ol.order_id=ANY($2::uuid[]) ORDER BY ol.line_number`,[context.organizationId,orderIds]):{rows:[] as Row[]};
    const linesByOrder=new Map<string,Row[]>(); for(const line of lineRows.rows){const key=String(line.order_id);const entries=linesByOrder.get(key)??[];entries.push(mapRow(line));linesByOrder.set(key,entries);}
    const visible:Row[]=[]; for(const row of result.rows) if(await maySeeProvince(client,context,row.province_id as string|null)) visible.push({...mapRow(row),lines:linesByOrder.get(String(row.id))??[]}); return visible;
  });
}

export async function confirmOrder(context:SalesContext,orderId:string){return withTenantContext(context,async client=>{const current=await getOrderInTransaction(client,context,orderId);if(current.status!=="draft")throw new BadRequestError("Only a draft sales order can be confirmed");for(const line of current.lines as Row[])if(line.operationalOfferId)await assertOfferAvailable(client,context,String(line.operationalOfferId),number(line.quantity));await client.query("UPDATE sales_orders SET status='confirmed',confirmed_by=$3,confirmed_at=now() WHERE organization_id=$1 AND id=$2",[context.organizationId,orderId,context.userId]);return getOrderInTransaction(client,context,orderId);});}

async function adjustInventoryForSale(client:PoolClient,context:SalesContext,warehouseId:string,itemId:string,quantity:number,deliveryId:string,notes:string|null){
  const updated=await client.query("UPDATE management_inventory_stock SET quantity_on_hand=quantity_on_hand-$4,updated_at=now() WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 AND quantity_on_hand-$4>=0",[context.organizationId,warehouseId,itemId,quantity]);
  if(!updated.rowCount)throw new BadRequestError("There is not enough available inventory in the selected warehouse");
  await client.query("INSERT INTO management_inventory_stock_movements (organization_id,warehouse_id,item_id,movement_type,quantity_delta,reference_type,reference_id,performed_by_member_id,notes) VALUES ($1,$2,$3,'issue',$4,'sales_delivery',$5,$6,$7)",[context.organizationId,warehouseId,itemId,-quantity,deliveryId,context.memberId,notes]);
}

export async function deliverOrder(context:SalesContext,orderId:string,input:DeliveryInput){return withTenantContext(context,async client=>{
  const order=await getOrderInTransaction(client,context,orderId);if(!["confirmed","partially_delivered"].includes(String(order.status)))throw new BadRequestError("Confirm the sales order before recording a delivery");
  const lineIds=input.lines.map(x=>x.orderLineId);if(new Set(lineIds).size!==lineIds.length)throw new BadRequestError("Each sales order line can appear only once in a delivery");
  if(input.warehouseId){const warehouse=await client.query<{site_id:string,province_id:string}>("SELECT w.site_id,s.province_id FROM management_warehouses w JOIN sites s ON s.organization_id=w.organization_id AND s.id=w.site_id WHERE w.organization_id=$1 AND w.id=$2 AND w.is_active",[context.organizationId,input.warehouseId]);if(!warehouse.rowCount)throw new NotFoundError("Active warehouse not found");await assertProvinceScope(client,context,warehouse.rows[0]!.province_id);}
  const delivery=await client.query<Row>(`INSERT INTO sales_deliveries (organization_id,order_id,delivery_number,delivered_on,warehouse_id,vehicle_id,driver_name,received_by,status,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'delivered',$9,$10) RETURNING *`,[context.organizationId,orderId,input.deliveryNumber??generated("DLV"),input.deliveredOn,input.warehouseId??null,input.vehicleId??null,input.driverName??null,input.receivedBy??null,input.notes??null,context.userId]);
  for(const requested of input.lines){
    const lineResult=await client.query<Row>("SELECT * FROM sales_order_lines WHERE organization_id=$1 AND id=$2 AND order_id=$3 FOR UPDATE",[context.organizationId,requested.orderLineId,orderId]); if(!lineResult.rowCount)throw new BadRequestError("A delivery line does not belong to this sales order"); const line=lineResult.rows[0]!;
    if(requested.quantity>number(line.quantity)-number(line.delivered_quantity)+0.00001)throw new BadRequestError("Delivered quantity cannot exceed the quantity still due");
    if(line.operational_offer_id){const offer=await assertOfferAvailable(client,context,String(line.operational_offer_id),requested.quantity);if(offer.source_type==='inventory_item'){if(!input.warehouseId)throw new BadRequestError("Choose the warehouse for inventory delivery");await adjustInventoryForSale(client,context,input.warehouseId,String(offer.source_id),requested.quantity,String(delivery.rows[0]!.id),input.notes??null);}}
    await client.query("INSERT INTO sales_delivery_lines (organization_id,delivery_id,order_line_id,quantity) VALUES ($1,$2,$3,$4)",[context.organizationId,delivery.rows[0]!.id,requested.orderLineId,requested.quantity]);
    await client.query("UPDATE sales_order_lines SET delivered_quantity=delivered_quantity+$3 WHERE organization_id=$1 AND id=$2",[context.organizationId,requested.orderLineId,requested.quantity]);
  }
  const status=await client.query<{due:string}>("SELECT COALESCE(SUM(quantity-delivered_quantity),0) AS due FROM sales_order_lines WHERE organization_id=$1 AND order_id=$2",[context.organizationId,orderId]); await client.query("UPDATE sales_orders SET status=$3 WHERE organization_id=$1 AND id=$2",[context.organizationId,orderId,number(status.rows[0]?.due)<=0.00001?"delivered":"partially_delivered"]);
  return mapRow(delivery.rows[0]!);
});}

export async function invoiceOrder(context:SalesContext,orderId:string){
  const issued=await withTenantContext(context,async client=>{
    const order=await getOrderInTransaction(client,context,orderId);
    if(String(order.status)!=="delivered")throw new BadRequestError("Complete the delivery before issuing this invoice");
    const prior=await client.query("SELECT id FROM sales_invoices WHERE organization_id=$1 AND order_id=$2 AND status<>'cancelled'",[context.organizationId,orderId]);
    if(prior.rowCount)throw new ConflictError("An invoice already exists for this sales order");
    const lines=(order.lines as Row[]).filter(line=>number(line.deliveredQuantity)>0);
    if(!lines.length)throw new BadRequestError("No delivered quantity is available to invoice");
    const invoiceLines=lines.map(line=>({line,quantity:number(line.deliveredQuantity),totals:lineTotal(number(line.deliveredQuantity),number(line.unitPrice),number(line.discountPercent),number(line.taxPercent))}));
    const subtotal=invoiceLines.reduce((sum,item)=>sum+item.totals.subtotal,0); const tax=invoiceLines.reduce((sum,item)=>sum+item.totals.tax,0); const total=subtotal+tax;
    const customer=await client.query<{payment_terms_days:number;name:string;email:string|null;phone:string|null}>("SELECT payment_terms_days,name,email,phone FROM customers WHERE organization_id=$1 AND id=$2",[context.organizationId,order.customerId]);
    if(!customer.rowCount)throw new NotFoundError("Customer not found");
    const invoiceDate=today();const due=new Date(`${invoiceDate}T00:00:00Z`);due.setUTCDate(due.getUTCDate()+number(customer.rows[0]!.payment_terms_days));
    const inv=await client.query<Row>(`INSERT INTO sales_invoices (organization_id,customer_id,order_id,province_id,invoice_number,invoice_date,due_date,status,currency,subtotal,tax_total,total,issued_at,created_by,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',$8,$9,$10,$11,now(),$12,$13) RETURNING *`,[context.organizationId,order.customerId,orderId,order.provinceId??null,generated("INV"),invoiceDate,due.toISOString().slice(0,10),order.currency,subtotal,tax,total,context.userId,order.notes??null]);
    for(const [index,item] of invoiceLines.entries())await client.query(`INSERT INTO sales_invoice_lines (organization_id,invoice_id,line_number,item_id,description,quantity,unit,unit_price,discount_percent,tax_percent,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[context.organizationId,inv.rows[0]!.id,index+1,item.line.itemId??null,item.line.description,item.quantity,item.line.unit,item.line.unitPrice,item.line.discountPercent,item.line.taxPercent,item.totals.total]);
    await client.query("UPDATE sales_orders SET status='invoiced' WHERE organization_id=$1 AND id=$2",[context.organizationId,orderId]);
    const organization=await client.query<{display_name:string;legal_name:string}>("SELECT display_name,legal_name FROM organizations WHERE id=$1",[context.organizationId]);
    return { invoice:mapRow(inv.rows[0]!), notice:{email:String(customer.rows[0]!.email??"").trim()||null,phone:String(customer.rows[0]!.phone??"").trim()||null,companyName:organization.rows[0]?.display_name||organization.rows[0]?.legal_name||"LiteHubs",customerName:customer.rows[0]!.name,invoiceNumber:String(inv.rows[0]!.invoice_number),invoiceDate,dueDate:due.toISOString().slice(0,10),currency:String(order.currency),total,lines:invoiceLines.map(item=>({description:String(item.line.description),quantity:item.quantity,unit:String(item.line.unit),lineTotal:item.totals.total}))} };
  });
  await sendIssuedInvoiceNotice(issued.notice);
  return issued.invoice;
}async function ensureRevenueAccounts(client:PoolClient,context:SalesContext,currencyCode:string){
  const wanted=[{code:`CASH-${currencyCode}`,name:`Cash / bank receipts (${currencyCode})`,type:"asset"},{code:`SALES-${currencyCode}`,name:`Sales revenue (${currencyCode})`,type:"income"}]; const accounts:Record<string,string>={};
  for(const account of wanted){const existing=await client.query<{id:string}>("SELECT id FROM finance_accounts WHERE organization_id=$1 AND code=$2",[context.organizationId,account.code]);if(existing.rowCount)accounts[account.type]=existing.rows[0]!.id;else{const inserted=await client.query<{id:string}>("INSERT INTO finance_accounts (organization_id,code,name,account_type,currency,is_postable,is_active,description) VALUES ($1,$2,$3,$4,$5,true,true,'Created automatically for sales receipts') RETURNING id",[context.organizationId,account.code,account.name,account.type,currencyCode]);accounts[account.type]=inserted.rows[0]!.id;}}
  return {cash:accounts.asset!,income:accounts.income!};
}

async function postPaymentRevenue(client:PoolClient,context:SalesContext,payment:Row){const exists=await client.query("SELECT 1 FROM finance_journal_entries WHERE organization_id=$1 AND source_table='customer_payments' AND source_id=$2",[context.organizationId,payment.id]);if(exists.rowCount)return;const accounts=await ensureRevenueAccounts(client,context,String(payment.currency));const entry=await client.query<{id:string}>(`INSERT INTO finance_journal_entries (organization_id,entry_number,entry_date,entry_type,description,currency,status,source_table,source_id,created_by,posted_by,posted_at) VALUES ($1,$2,$3,'customer_payment',$4,$5,'posted','customer_payments',$6,$7,$7,now()) RETURNING id`,[context.organizationId,generated("JE"),payment.received_on,String(payment.payment_number),String(payment.currency),payment.id,context.userId]);const amount=number(payment.amount);await client.query(`INSERT INTO finance_journal_lines (organization_id,entry_id,line_number,account_id,amount,description,province_id) VALUES ($1,$2,1,$3,$4,'Customer payment received',$5),($1,$2,2,$6,$7,'Sales revenue',$5)`,[context.organizationId,entry.rows[0]!.id,accounts.cash,amount,payment.province_id??null,accounts.income,-amount]);}

export async function receivePayment(context:SalesContext,input:PaymentInput){return withTenantContext(context,async client=>{const customer=await client.query<{province_id:string|null}>("SELECT province_id FROM customers WHERE organization_id=$1 AND id=$2",[context.organizationId,input.customerId]);if(!customer.rowCount)throw new NotFoundError("Customer not found");await assertProvinceScope(client,context,customer.rows[0]!.province_id);const payment=await client.query<Row>(`INSERT INTO customer_payments (organization_id,customer_id,payment_number,received_on,method,currency,amount,allocated_amount,reference,notes,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[context.organizationId,input.customerId,input.paymentNumber??generated("PAY"),input.receivedOn,input.method,input.currency,input.amount,input.allocations.reduce((sum,a)=>sum+a.amount,0),input.reference??null,input.notes??null,context.userId]);for(const allocation of input.allocations){const invoice=await client.query<Row>("SELECT * FROM sales_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE",[context.organizationId,allocation.invoiceId]);if(!invoice.rowCount||String(invoice.rows[0]!.customer_id)!==input.customerId)throw new BadRequestError("An allocation invoice does not belong to this customer");if(String(invoice.rows[0]!.currency)!==input.currency)throw new BadRequestError("Payment currency must match invoice currency");if(allocation.amount>number(invoice.rows[0]!.total)-number(invoice.rows[0]!.paid_total)+0.00001)throw new BadRequestError("Payment allocation exceeds the invoice balance");await client.query("INSERT INTO payment_allocations (organization_id,payment_id,invoice_id,amount,allocated_by) VALUES ($1,$2,$3,$4,$5)",[context.organizationId,payment.rows[0]!.id,allocation.invoiceId,allocation.amount,context.userId]);const newPaid=number(invoice.rows[0]!.paid_total)+allocation.amount;await client.query("UPDATE sales_invoices SET paid_total=$3,status=$4 WHERE organization_id=$1 AND id=$2",[context.organizationId,allocation.invoiceId,newPaid,newPaid>=number(invoice.rows[0]!.total)-.00001?"paid":"partially_paid"]);}await postPaymentRevenue(client,context,payment.rows[0]!);return mapRow(payment.rows[0]!);});}

export async function financeSummary(context:SalesContext){return withTenantContext(context,async client=>{
  const [cash,receivables,orders]=await Promise.all([
    client.query<Row>(`SELECT currency,COALESCE(SUM(CASE WHEN received_on>=date_trunc('month',CURRENT_DATE) THEN amount ELSE 0 END),0) AS month_cash_received,COALESCE(SUM(amount),0) AS cash_received FROM customer_payments WHERE organization_id=$1 GROUP BY currency`,[context.organizationId]),
    client.query<Row>(`SELECT currency,COALESCE(SUM(total-paid_total),0) AS outstanding,COUNT(*) FILTER (WHERE due_date<CURRENT_DATE AND status IN ('issued','partially_paid','overdue')) AS overdue_invoices FROM sales_invoices WHERE organization_id=$1 AND status IN ('issued','partially_paid','overdue') GROUP BY currency`,[context.organizationId]),
    client.query<Row>(`SELECT currency,COUNT(*) FILTER (WHERE status IN ('confirmed','partially_delivered')) AS open_orders,COALESCE(SUM(total) FILTER (WHERE status IN ('confirmed','partially_delivered')),0) AS open_order_value FROM sales_orders WHERE organization_id=$1 GROUP BY currency`,[context.organizationId]),
  ]);
  const byCurrency=new Map<string,Row>();
  for(const row of cash.rows) byCurrency.set(String(row.currency),{currency:row.currency,monthCashReceived:number(row.month_cash_received),cashReceived:number(row.cash_received),outstanding:0,overdueInvoices:0,openOrders:0,openOrderValue:0});
  for(const row of receivables.rows){const current=byCurrency.get(String(row.currency))??{currency:row.currency,monthCashReceived:0,cashReceived:0,openOrders:0,openOrderValue:0};byCurrency.set(String(row.currency),{...current,outstanding:number(row.outstanding),overdueInvoices:number(row.overdue_invoices)});}
  for(const row of orders.rows){const current=byCurrency.get(String(row.currency))??{currency:row.currency,monthCashReceived:0,cashReceived:0,outstanding:0,overdueInvoices:0};byCurrency.set(String(row.currency),{...current,openOrders:number(row.open_orders),openOrderValue:number(row.open_order_value)});}
  return { byCurrency:[...byCurrency.values()] };
});}
export async function listPayments(context:SalesContext,query:SalesListQuery){return withTenantContext(context,async client=>{const { limit, offset }=pageWindow(query);const result=await client.query<Row>(`SELECT p.*,c.name AS customer_name,c.province_id FROM customer_payments p JOIN customers c ON c.organization_id=p.organization_id AND c.id=p.customer_id WHERE p.organization_id=$1 ORDER BY p.received_on DESC,p.created_at DESC LIMIT $2 OFFSET $3`,[context.organizationId,limit,offset]);const visible:Row[]=[];for(const row of result.rows)if(await maySeeProvince(client,context,row.province_id as string|null))visible.push(mapRow(row));return visible;});}

