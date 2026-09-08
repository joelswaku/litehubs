import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const date = z.string().date("Use YYYY-MM-DD");
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/, "Use letters, numbers, hyphens or underscores");
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => requiredText(max).nullable().optional();
const positive = z.coerce.number().finite().positive();
const nonnegative = z.coerce.number().finite().nonnegative();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency such as CDF");

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const salesIdParams = organizationParams.extend({ id });
export const salesOrderParams = organizationParams.extend({ orderId: id });
export const salesDeliveryParams = organizationParams.extend({ deliveryId: id });

export const saleSourceTypes = ["egg_flock", "poultry_flock", "pig_group", "pig_animal", "harvest_planting", "inventory_item"] as const;

export const customerInput = z.object({
  code,
  name: requiredText(220),
  customerType: z.enum(["business", "individual", "government", "cooperative", "internal"]).default("business"),
  contactName: optionalText(160),
  phone: optionalText(80),
  email: z.string().trim().email("Use a valid email address").nullable().optional(),
  addressLine1: optionalText(220),
  addressLine2: optionalText(220),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(40),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code").nullable().optional(),
  currency: currency.nullable().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  creditLimit: nonnegative.nullable().optional(),
  provinceId: id.nullable().optional(),
  isActive: z.boolean().default(true),
  notes: optionalText(4000),
});

export const offerInput = z.object({
  code,
  title: requiredText(220).optional(),
  sourceType: z.enum(saleSourceTypes),
  sourceId: id,
  defaultUnitPrice: nonnegative.nullable().optional(),
  currency: currency.nullable().optional(),
  minimumQuantity: nonnegative.default(0),
  isAvailable: z.boolean().default(true),
  ecommerceStatus: z.enum(["internal", "ready_for_sync", "synced", "paused"]).default("internal"),
  notes: optionalText(4000),
}).superRefine((value, ctx) => {
  if (value.defaultUnitPrice !== null && value.defaultUnitPrice !== undefined && !value.currency)
    ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency for the selling price" });
});

const salesLine = z.object({
  offerId: id.nullable().optional(),
  itemId: id.nullable().optional(),
  description: requiredText(500),
  quantity: positive,
  unit: requiredText(40).default("unit"),
  unitPrice: nonnegative,
  discountPercent: nonnegative.max(100).default(0),
  taxPercent: nonnegative.max(100).default(0),
});

export const createOrderInput = z.object({
  customerId: id,
  provinceId: id.nullable().optional(),
  siteId: id.nullable().optional(),
  orderNumber: code.optional(),
  orderDate: date.default(() => new Date().toISOString().slice(0, 10)),
  requiredDate: date.nullable().optional(),
  currency,
  notes: optionalText(4000),
  lines: z.array(salesLine).min(1).max(200),
}).superRefine((value, ctx) => {
  if (value.requiredDate && value.requiredDate < value.orderDate)
    ctx.addIssue({ code: "custom", path: ["requiredDate"], message: "Required date cannot be before order date" });
});

export const deliveryInput = z.object({
  deliveryNumber: code.optional(),
  deliveredOn: date.default(() => new Date().toISOString().slice(0, 10)),
  warehouseId: id.nullable().optional(),
  vehicleId: id.nullable().optional(),
  driverName: optionalText(160),
  receivedBy: optionalText(160),
  notes: optionalText(4000),
  lines: z.array(z.object({ orderLineId: id, quantity: positive })).min(1).max(200),
});

export const paymentInput = z.object({
  customerId: id,
  paymentNumber: code.optional(),
  receivedOn: date.default(() => new Date().toISOString().slice(0, 10)),
  method: z.enum(["cash", "bank_transfer", "mobile_money", "cheque", "card", "offset"]).default("cash"),
  currency,
  amount: positive,
  reference: optionalText(160),
  notes: optionalText(4000),
  allocations: z.array(z.object({ invoiceId: id, amount: positive })).max(100).default([]),
}).superRefine((value, ctx) => {
  const total = value.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (total > value.amount + 0.00001)
    ctx.addIssue({ code: "custom", path: ["allocations"], message: "Allocated amount cannot exceed the payment" });
});

export const salesListQuery = z.object({
  provinceId: id.optional(),
  siteId: id.optional(),
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CustomerInput = z.infer<typeof customerInput>;
export type OfferInput = z.infer<typeof offerInput>;
export type CreateOrderInput = z.infer<typeof createOrderInput>;
export type DeliveryInput = z.infer<typeof deliveryInput>;
export type PaymentInput = z.infer<typeof paymentInput>;
export type SalesListQuery = z.infer<typeof salesListQuery>;
