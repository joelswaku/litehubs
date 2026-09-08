import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./sales.controller";
import { createOrderInput, customerInput, deliveryInput, offerInput, organizationParams, paymentInput, salesListQuery, salesOrderParams } from "./sales.validation";

export const salesRoutes=Router();
const inside=[authenticate,validate({params:organizationParams}),requireOrganization] as const;

salesRoutes.get("/organizations/:orgSlug/customers",...inside,requirePermission("customers.read"),validate({query:salesListQuery}),controller.customers);
salesRoutes.post("/organizations/:orgSlug/customers",...inside,requirePermission("customers.create"),validate({body:customerInput}),controller.createCustomer);
salesRoutes.get("/organizations/:orgSlug/sales/sources",...inside,requirePermission("sales.read"),controller.sources);
salesRoutes.get("/organizations/:orgSlug/sales/warehouses",...inside,requirePermission("sales.read"),controller.warehouses);
salesRoutes.get("/organizations/:orgSlug/sales/production-summary",...inside,requirePermission("sales.read"),controller.productionSummary);
salesRoutes.get("/organizations/:orgSlug/sales/offers",...inside,requirePermission("sales.read"),validate({query:salesListQuery}),controller.offers);
salesRoutes.post("/organizations/:orgSlug/sales/offers",...inside,requirePermission("sales.create"),validate({body:offerInput}),controller.createOffer);
salesRoutes.get("/organizations/:orgSlug/sales/orders",...inside,requirePermission("sales.read"),validate({query:salesListQuery}),controller.orders);
salesRoutes.post("/organizations/:orgSlug/sales/orders",...inside,requirePermission("sales.create"),validate({body:createOrderInput}),controller.createOrder);
salesRoutes.post("/organizations/:orgSlug/sales/orders/:orderId/confirm",authenticate,validate({params:salesOrderParams}),requireOrganization,requirePermission("sales.update"),controller.confirmOrder);
salesRoutes.post("/organizations/:orgSlug/sales/orders/:orderId/deliveries",authenticate,validate({params:salesOrderParams,body:deliveryInput}),requireOrganization,requirePermission("sales.update"),controller.deliverOrder);
salesRoutes.post("/organizations/:orgSlug/sales/orders/:orderId/invoice",authenticate,validate({params:salesOrderParams}),requireOrganization,requirePermission("sales.update"),controller.invoiceOrder);
salesRoutes.get("/organizations/:orgSlug/sales/payments",...inside,requirePermission("sales.read"),validate({query:salesListQuery}),controller.payments);
salesRoutes.post("/organizations/:orgSlug/sales/payments",...inside,requirePermission("sales.create"),validate({body:paymentInput}),controller.receivePayment);
salesRoutes.get("/organizations/:orgSlug/finance/sales-summary",...inside,requirePermission("finance.transactions.read"),controller.financeSummary);
