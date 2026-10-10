import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { logger } from "../../config/logger";
import { storeImage } from "../../services/file-storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { customerServiceStaff, type ChatContext } from "../chat/chat.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { nextCustomerCode, offerWithAvailability, withdrawalBlock, type SalesContext } from "../sales/sales.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const num = (value: unknown) => Number(value ?? 0);

/* ------------------------------------------------------------------ */
/* Rights                                                              */
/* ------------------------------------------------------------------ */

const canManageShop = (context: ChatContext) =>
  context.isOwner || ["website.edit", "sales.update", "sales.create"].some((code) => context.permissions.includes(code));
const canSeeOrders = (context: ChatContext) =>
  context.isOwner || ["sales.read", "sales.update"].some((code) => context.permissions.includes(code));
function assertShop(context: ChatContext) {
  if (!canManageShop(context)) throw new ForbiddenError("Réservé aux responsables du site ou des ventes.");
}
function assertOrders(context: ChatContext) {
  if (!canSeeOrders(context)) throw new ForbiddenError("Réservé aux responsables des ventes.");
}
const salesContext = (context: ChatContext): SalesContext => ({
  organizationId: context.organizationId,
  userId: context.userId,
  memberId: context.memberId,
  isOwner: context.isOwner,
  permissions: context.permissions,
});
const systemSales = (organizationId: string): SalesContext => ({
  organizationId,
  userId: "",
  memberId: "",
  isOwner: true,
  permissions: [],
});

/* ------------------------------------------------------------------ */
/* Settings & categories                                               */
/* ------------------------------------------------------------------ */

type Settings = {
  enabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryNote: string | null;
  paymentNote: string | null;
  orderNote: string | null;
};

async function settingsOf(client: PoolClient, organizationId: string): Promise<Settings> {
  const row = (await client.query<Row>(`SELECT * FROM shop_settings WHERE organization_id=$1`, [organizationId])).rows[0];
  return {
    enabled: Boolean(row?.enabled),
    deliveryEnabled: row ? Boolean(row.delivery_enabled) : true,
    pickupEnabled: row ? Boolean(row.pickup_enabled) : true,
    deliveryNote: row?.delivery_note ?? null,
    paymentNote: row?.payment_note ?? null,
    orderNote: row?.order_note ?? null,
  };
}

async function categoriesOf(client: PoolClient, organizationId: string, onlyVisible = false) {
  const result = await client.query<Row>(
    `SELECT * FROM shop_categories WHERE organization_id=$1 ${onlyVisible ? "AND is_visible" : ""} ORDER BY sort_order, name_fr`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    nameFr: row.name_fr as string,
    nameEn: (row.name_en as string | null) ?? null,
    sortOrder: num(row.sort_order),
    isVisible: Boolean(row.is_visible),
  }));
}

/* ------------------------------------------------------------------ */
/* Team side: catalogue                                                */
/* ------------------------------------------------------------------ */

function adminProduct(row: Row, blockedUntil: string | null) {
  return {
    blockedUntil,
    id: row.id as string,
    code: row.code as string,
    title: row.title as string,
    sourceType: row.sourceType as string,
    unit: row.unit as string,
    price: row.defaultUnitPrice === null ? null : num(row.defaultUnitPrice),
    currency: (row.currency as string | null) ?? "CDF",
    minimumQuantity: num(row.minimumQuantity),
    isAvailable: Boolean(row.isAvailable),
    availableQuantity: num(row.availableQuantity),
    saleReady: Boolean(row.saleReady),
    web: {
      visible: Boolean(row.webVisible),
      title: (row.webTitle as string | null) ?? null,
      description: (row.webDescription as string | null) ?? null,
      imageUrl: (row.webImageUrl as string | null) ?? null,
      categoryId: (row.webCategoryId as string | null) ?? null,
      sortOrder: num(row.webSortOrder),
      quantityStep: num(row.webQuantityStep) || 1,
      unitLabel: (row.webUnitLabel as string | null) ?? null,
    },
  };
}

export async function adminOverview(context: ChatContext) {
  assertShop(context);
  return withTenantContext(context, async (client) => {
    const offers = await client.query<Row>(
      `SELECT * FROM sales_operational_offers WHERE organization_id=$1 ORDER BY web_visible DESC, web_sort_order, title`,
      [context.organizationId],
    );
    const products = [];
    for (const row of offers.rows)
      products.push(
        adminProduct(
          await offerWithAvailability(client, salesContext(context), row),
          await withdrawalBlock(client, context.organizationId, row),
        ),
      );
    const pending = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM sales_orders WHERE organization_id=$1 AND channel='website' AND status='draft'`,
      [context.organizationId],
    );
    const site = await client.query<{ slug: string }>(`SELECT slug FROM organizations WHERE id=$1`, [context.organizationId]);
    return {
      settings: await settingsOf(client, context.organizationId),
      categories: await categoriesOf(client, context.organizationId),
      products,
      pendingOrders: Number(pending.rows[0]?.total ?? 0),
      canSeeOrders: canSeeOrders(context),
      siteSlug: site.rows[0]?.slug ?? context.organizationSlug,
    };
  });
}

export async function saveSettings(context: ChatContext, input: Settings) {
  assertShop(context);
  await withTenantContext(context, (client) =>
    client.query(
      `INSERT INTO shop_settings(organization_id,enabled,delivery_enabled,pickup_enabled,delivery_note,payment_note,order_note,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (organization_id) DO UPDATE SET enabled=EXCLUDED.enabled,delivery_enabled=EXCLUDED.delivery_enabled,
         pickup_enabled=EXCLUDED.pickup_enabled,delivery_note=EXCLUDED.delivery_note,payment_note=EXCLUDED.payment_note,
         order_note=EXCLUDED.order_note,updated_at=now()`,
      [
        context.organizationId,
        input.enabled,
        input.deliveryEnabled,
        input.pickupEnabled,
        input.deliveryNote?.trim() || null,
        input.paymentNote?.trim() || null,
        input.orderNote?.trim() || null,
      ],
    ),
  );
  return adminOverview(context);
}

export async function saveCategory(
  context: ChatContext,
  categoryId: string | null,
  input: { nameFr: string; nameEn?: string | null; sortOrder?: number; isVisible?: boolean },
) {
  assertShop(context);
  await withTenantContext(context, async (client) => {
    if (categoryId) {
      const updated = await client.query(
        `UPDATE shop_categories SET name_fr=$3,name_en=$4,sort_order=COALESCE($5,sort_order),is_visible=COALESCE($6,is_visible)
          WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, categoryId, input.nameFr.trim(), input.nameEn?.trim() || null, input.sortOrder ?? null, input.isVisible ?? null],
      );
      if (!updated.rowCount) throw new NotFoundError("Catégorie introuvable");
    } else
      await client.query(
        `INSERT INTO shop_categories(organization_id,name_fr,name_en,sort_order,is_visible) VALUES($1,$2,$3,$4,$5)`,
        [context.organizationId, input.nameFr.trim(), input.nameEn?.trim() || null, input.sortOrder ?? 0, input.isVisible ?? true],
      );
  });
  return adminOverview(context);
}

export async function deleteCategory(context: ChatContext, categoryId: string) {
  assertShop(context);
  await withTenantContext(context, (client) =>
    client.query(`DELETE FROM shop_categories WHERE organization_id=$1 AND id=$2`, [context.organizationId, categoryId]),
  );
  return adminOverview(context);
}

export async function saveProduct(
  context: ChatContext,
  offerId: string,
  input: {
    price?: number | null;
    isAvailable?: boolean;
    minimumQuantity?: number;
    web: {
      visible: boolean;
      title?: string | null;
      description?: string | null;
      imageUrl?: string | null;
      categoryId?: string | null;
      sortOrder?: number;
      quantityStep?: number;
      unitLabel?: string | null;
    };
  },
) {
  assertShop(context);
  await withTenantContext(context, async (client) => {
    if (input.web.categoryId) {
      const category = await client.query(`SELECT 1 FROM shop_categories WHERE organization_id=$1 AND id=$2`, [
        context.organizationId,
        input.web.categoryId,
      ]);
      if (!category.rowCount) throw new BadRequestError("Catégorie introuvable");
    }
    if (input.web.visible && (input.price === null || (input.price === undefined && !(await hasPrice(client, context, offerId)))))
      throw new BadRequestError("Indiquez un prix avant de montrer ce produit sur le site.");
    const updated = await client.query(
      `UPDATE sales_operational_offers
          SET default_unit_price=CASE WHEN $3::boolean THEN $4::numeric ELSE default_unit_price END,
              is_available=COALESCE($5,is_available),
              minimum_quantity=COALESCE($6,minimum_quantity),
              web_visible=$7,web_title=$8,web_description=$9,web_image_url=$10,web_category_id=$11,
              web_sort_order=COALESCE($12,web_sort_order),web_quantity_step=COALESCE($13,web_quantity_step),web_unit_label=$14,
              updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        offerId,
        input.price !== undefined,
        input.price ?? null,
        input.isAvailable ?? null,
        input.minimumQuantity ?? null,
        input.web.visible,
        input.web.title?.trim() || null,
        input.web.description?.trim() || null,
        input.web.imageUrl || null,
        input.web.categoryId || null,
        input.web.sortOrder ?? null,
        input.web.quantityStep ?? null,
        input.web.unitLabel?.trim() || null,
      ],
    );
    if (!updated.rowCount) throw new NotFoundError("Produit introuvable");
  });
  return adminOverview(context);
}

async function hasPrice(client: PoolClient, context: ChatContext, offerId: string) {
  const row = await client.query<{ price: string | null }>(
    `SELECT default_unit_price::text AS price FROM sales_operational_offers WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, offerId],
  );
  return row.rows[0]?.price != null;
}

export async function uploadProductImage(context: ChatContext, file: Express.Multer.File) {
  assertShop(context);
  const image = await storeImage({
    organizationId: context.organizationId,
    module: "shop",
    resource: "products",
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  return { url: image.url };
}

/* ------------------------------------------------------------------ */
/* Team side: website orders                                           */
/* ------------------------------------------------------------------ */

function mapOrder(row: Row, lines: Row[] = []) {
  return {
    id: row.id as string,
    number: row.order_number as string,
    status: row.status as string,
    createdAt: row.created_at,
    total: num(row.total),
    currency: row.currency as string,
    contact: { name: row.contact_name, phone: row.contact_phone, email: row.contact_email },
    deliveryMode: row.delivery_mode as string | null,
    deliveryAddress: row.delivery_address as string | null,
    note: row.customer_note as string | null,
    cancelledReason: row.cancelled_reason as string | null,
    customerId: row.customer_id as string,
    lines: lines.map((line) => ({
      description: line.description as string,
      quantity: num(line.quantity),
      unit: line.unit as string,
      unitPrice: num(line.unit_price),
      total: num(line.line_total),
    })),
  };
}

async function linesOf(client: PoolClient, organizationId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Row[]>();
  const result = await client.query<Row>(
    `SELECT * FROM sales_order_lines WHERE organization_id=$1 AND order_id = ANY($2::uuid[]) ORDER BY line_number`,
    [organizationId, orderIds],
  );
  const map = new Map<string, Row[]>();
  for (const line of result.rows) map.set(line.order_id, [...(map.get(line.order_id) ?? []), line]);
  return map;
}

export async function listWebOrders(context: ChatContext, filter: "todo" | "all") {
  assertOrders(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT * FROM sales_orders WHERE organization_id=$1 AND channel='website' ${filter === "todo" ? "AND status='draft'" : ""}
        ORDER BY created_at DESC LIMIT 200`,
      [context.organizationId],
    );
    const lines = await linesOf(client, context.organizationId, result.rows.map((row) => row.id));
    return { orders: result.rows.map((row) => mapOrder(row, lines.get(row.id))) };
  });
}

/** "Annuler" a web order that cannot be served (out of stock, no answer…). */
export async function cancelWebOrder(context: ChatContext, orderId: string, reason: string) {
  assertOrders(context);
  if (!context.isOwner && !context.permissions.includes("sales.update")) throw new ForbiddenError("Droit « ventes : modifier » requis.");
  await withTenantContext(context, async (client) => {
    const updated = await client.query(
      `UPDATE sales_orders SET status='cancelled',cancelled_reason=$3,confirmed_at=COALESCE(confirmed_at,now()),updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND channel='website' AND status='draft'`,
      [context.organizationId, orderId, reason.trim().slice(0, 300) || null],
    );
    if (!updated.rowCount) throw new BadRequestError("Seule une commande web en attente peut être annulée ici.");
  });
  return listWebOrders(context, "all");
}

/* ------------------------------------------------------------------ */
/* Public side                                                         */
/* ------------------------------------------------------------------ */

type Target = { organizationId: string; organizationSlug: string; organizationName: string; enabled: boolean };

async function target(site: string): Promise<Target> {
  const result = await db.query<{ payload: Target | null }>(`SELECT public_shop_target($1) AS payload`, [site]);
  const payload = result.rows[0]?.payload;
  if (!payload || !payload.enabled) throw new NotFoundError("La boutique n’est pas disponible.");
  return payload;
}

async function publicProducts(client: PoolClient, organizationId: string) {
  const offers = await client.query<Row>(
    `SELECT o.* FROM sales_operational_offers o
       LEFT JOIN shop_categories c ON c.organization_id=o.organization_id AND c.id=o.web_category_id
      WHERE o.organization_id=$1 AND o.web_visible AND o.default_unit_price IS NOT NULL
        AND (o.web_category_id IS NULL OR c.is_visible)
      ORDER BY c.sort_order NULLS LAST, o.web_sort_order, o.title`,
    [organizationId],
  );
  const products = [];
  for (const row of offers.rows) {
    const withStock = await offerWithAvailability(client, systemSales(organizationId), row);
    const blocked = await withdrawalBlock(client, organizationId, row);
    const minimum = Math.max(num(row.minimum_quantity), num(row.web_quantity_step) || 1);
    products.push({
      id: row.id as string,
      title: (row.web_title as string | null) || (row.title as string),
      description: (row.web_description as string | null) ?? null,
      imageUrl: (row.web_image_url as string | null) ?? null,
      categoryId: (row.web_category_id as string | null) ?? null,
      unit: row.unit as string,
      unitLabel: (row.web_unit_label as string | null) ?? null,
      price: num(row.default_unit_price),
      currency: (row.currency as string | null) ?? "CDF",
      minimumQuantity: minimum,
      quantityStep: num(row.web_quantity_step) || 1,
      // Customers see "Disponible / Épuisé", never the exact stock.
      available: Boolean(row.is_available) && !blocked && num(withStock.availableQuantity) >= minimum,
      _stock: num(withStock.availableQuantity),
    });
  }
  return products;
}

export async function publicCatalog(site: string) {
  const found = await target(site);
  return withTenantContext({ organizationId: found.organizationId, userId: null }, async (client) => {
    const settings = await settingsOf(client, found.organizationId);
    const products = await publicProducts(client, found.organizationId);
    return {
      organizationName: found.organizationName,
      settings: {
        deliveryEnabled: settings.deliveryEnabled,
        pickupEnabled: settings.pickupEnabled,
        deliveryNote: settings.deliveryNote,
        paymentNote: settings.paymentNote,
        orderNote: settings.orderNote,
      },
      categories: (await categoriesOf(client, found.organizationId, true)).map(({ id, nameFr, nameEn }) => ({ id, nameFr, nameEn })),
      products: products.map(({ _stock, ...product }) => product), // eslint-disable-line @typescript-eslint/no-unused-vars
    };
  });
}

type OrderInput = {
  items: { productId: string; quantity: number }[];
  name: string;
  phone: string;
  email?: string;
  deliveryMode: "delivery" | "pickup";
  address?: string;
  note?: string;
};

export async function placeOrder(site: string, input: OrderInput) {
  const found = await target(site);
  const token = randomBytes(24).toString("base64url");
  const result = await withTenantContext({ organizationId: found.organizationId, userId: null }, async (client) => {
    const settings = await settingsOf(client, found.organizationId);
    if (input.deliveryMode === "delivery" && !settings.deliveryEnabled) throw new BadRequestError("La livraison n’est pas proposée.");
    if (input.deliveryMode === "pickup" && !settings.pickupEnabled) throw new BadRequestError("Le retrait n’est pas proposé.");
    if (input.deliveryMode === "delivery" && !input.address?.trim()) throw new BadRequestError("Indiquez l’adresse de livraison.");
    const catalog = await publicProducts(client, found.organizationId);
    const merged = new Map<string, number>();
    for (const item of input.items) merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    const lines = [...merged.entries()].map(([productId, quantity]) => {
      const product = catalog.find((entry) => entry.id === productId);
      if (!product) throw new BadRequestError("Un produit du panier n’est plus en vente. Actualisez la page.");
      if (!product.available || quantity > product._stock + 1e-6)
        throw new BadRequestError(`« ${product.title} » n’est plus disponible dans cette quantité.`);
      if (quantity < product.minimumQuantity) throw new BadRequestError(`Minimum ${product.minimumQuantity} ${product.unitLabel ?? product.unit} pour « ${product.title} ».`);
      return { product, quantity, total: Math.round(quantity * product.price * 100) / 100 };
    });
    const currencies = new Set(lines.map((line) => line.product.currency));
    if (currencies.size > 1) throw new BadRequestError("Les produits du panier ont des devises différentes : passez deux commandes.");
    const currency = lines[0]!.product.currency;
    const total = lines.reduce((sum, line) => sum + line.total, 0);

    // Same customer as before when the phone or e-mail is known.
    const phone = input.phone.replace(/\s+/g, " ").trim();
    const email = input.email?.trim().toLowerCase() || null;
    let customer = (
      await client.query<{ id: string }>(
        `SELECT id FROM customers WHERE organization_id=$1 AND is_active
            AND (regexp_replace(COALESCE(phone,''),'\\D','','g')=regexp_replace($2,'\\D','','g') OR ($3::text IS NOT NULL AND lower(email)=$3))
          ORDER BY created_at LIMIT 1`,
        [found.organizationId, phone, email],
      )
    ).rows[0];
    if (!customer)
      customer = (
        await client.query<{ id: string }>(
          `INSERT INTO customers(organization_id,code,name,customer_type,contact_name,phone,email,address_line1,notes)
           VALUES($1,$2,$3,'individual',$3,$4,$5,$6,'Créé par une commande sur le site web') RETURNING id`,
          [
            found.organizationId,
            await nextCustomerCode(client, found.organizationId),
            input.name.trim(),
            phone,
            email,
            input.deliveryMode === "delivery" ? input.address?.trim() || null : null,
          ],
        )
      ).rows[0]!;

    const number = `WEB-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const order = await client.query<{ id: string }>(
      `INSERT INTO sales_orders(organization_id,customer_id,order_number,order_date,currency,subtotal,tax_total,total,notes,status,
                                channel,public_token_hash,contact_name,contact_phone,contact_email,delivery_mode,delivery_address,customer_note)
       VALUES($1,$2,$3,CURRENT_DATE,$4,$5,0,$5,$6,'draft','website',$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        found.organizationId,
        customer.id,
        number,
        currency,
        total,
        `Commande site web · ${input.deliveryMode === "delivery" ? `Livraison : ${input.address?.trim()}` : "Retrait"}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`.slice(0, 1000),
        hashToken(token),
        input.name.trim(),
        phone,
        email,
        input.deliveryMode,
        input.deliveryMode === "delivery" ? input.address?.trim() || null : null,
        input.note?.trim() || null,
      ],
    );
    for (const [index, line] of lines.entries())
      await client.query(
        `INSERT INTO sales_order_lines(organization_id,order_id,line_number,operational_offer_id,description,quantity,unit,unit_price,discount_percent,tax_percent,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9)`,
        [found.organizationId, order.rows[0]!.id, index + 1, line.product.id, line.product.title, line.quantity, line.product.unit, line.product.price, line.total],
      );

    // Alert the people who handle sales (else customer service / owner).
    const staff = await salesStaff(client, found.organizationId);
    for (const memberId of staff)
      await createNotificationInTransaction(client, {
        organizationId: found.organizationId,
        recipientMemberId: memberId,
        type: "shop_order",
        category: "general",
        priority: "high",
        title: `Nouvelle commande web ${number}`,
        message: `${input.name.trim()} · ${phone} · ${total.toLocaleString("fr-FR")} ${currency}`.slice(0, 160),
        actionUrl: `/${found.organizationSlug}/shop?tab=orders`,
        entityType: "sales_order",
        entityId: order.rows[0]!.id,
        deduplicationKey: `shop-order:${order.rows[0]!.id}:${memberId}`,
      });
    return { number, total, currency };
  });
  logger.info({ organizationId: found.organizationId, order: result.number }, "Website order placed");
  return { ...result, token };
}

async function salesStaff(client: PoolClient, organizationId: string) {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT m.id FROM organization_members m
       JOIN member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
       JOIN role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
       JOIN permissions p ON p.id=rp.permission_id AND p.code='sales.update'
      WHERE m.organization_id=$1 AND m.status='active' AND NOT m.is_owner`,
    [organizationId],
  );
  const owners = await client.query<{ id: string }>(
    `SELECT id FROM organization_members WHERE organization_id=$1 AND status='active' AND is_owner`,
    [organizationId],
  );
  const ids = new Set([...result.rows.map((row) => row.id), ...owners.rows.map((row) => row.id)]);
  if (ids.size === 0) for (const id of await customerServiceStaff(client, organizationId)) ids.add(id);
  return [...ids];
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Reçue — l’équipe va vous contacter pour confirmer",
  confirmed: "Confirmée",
  partially_delivered: "En partie livrée",
  delivered: "Livrée",
  invoiced: "Facturée",
  cancelled: "Annulée",
  closed: "Terminée",
};

/** Order tracking from the link given after checkout. */
export async function publicOrder(site: string, token: string) {
  const found = await target(site).catch(async () => {
    // The shop may have been closed since: tracking still works.
    const result = await db.query<{ payload: Target | null }>(`SELECT public_shop_target($1) AS payload`, [site]);
    if (!result.rows[0]?.payload) throw new NotFoundError("Commande introuvable");
    return result.rows[0].payload;
  });
  return withTenantContext({ organizationId: found.organizationId, userId: null }, async (client) => {
    const order = (
      await client.query<Row>(`SELECT * FROM sales_orders WHERE organization_id=$1 AND public_token_hash=$2`, [
        found.organizationId,
        hashToken(token),
      ])
    ).rows[0];
    if (!order) throw new NotFoundError("Commande introuvable");
    const lines = await linesOf(client, found.organizationId, [order.id]);
    const mapped = mapOrder(order, lines.get(order.id));
    return {
      number: mapped.number,
      status: mapped.status,
      statusLabel: STATUS_LABELS[mapped.status] ?? mapped.status,
      createdAt: mapped.createdAt,
      total: mapped.total,
      currency: mapped.currency,
      deliveryMode: mapped.deliveryMode,
      lines: mapped.lines,
      organizationName: found.organizationName,
    };
  });
}

/** "Mes commandes" in the customer account (orders of the linked customer). */
export async function ordersForCustomer(organizationId: string, customerId: string | null) {
  if (!customerId) return [];
  return withTenantContext({ organizationId, userId: null }, async (client) => {
    const result = await client.query<Row>(
      `SELECT * FROM sales_orders WHERE organization_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 50`,
      [organizationId, customerId],
    );
    const lines = await linesOf(client, organizationId, result.rows.map((row) => row.id));
    return result.rows.map((row) => {
      const mapped = mapOrder(row, lines.get(row.id));
      return {
        number: mapped.number,
        status: mapped.status,
        statusLabel: STATUS_LABELS[mapped.status] ?? mapped.status,
        createdAt: mapped.createdAt,
        total: mapped.total,
        currency: mapped.currency,
        lines: mapped.lines,
      };
    });
  });
}

