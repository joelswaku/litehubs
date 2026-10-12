import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./sales.controller";
import { createOrderInput, customerInput, customerUpdateInput, deliveryInput, offerInput, organizationParams, paymentInput, pdfPeriodQuery, salesIdParams, salesListQuery, salesOrderParams } from "./sales.validation";

export const salesRoutes=Router();
const inside=[authenticate,validate({params:organizationParams}),requireOrganization] as const;

salesRoutes.get("/organizations/:orgSlug/customers",...inside,requirePermission("customers.read"),validate({query:salesListQuery}),controller.customers);
salesRoutes.post("/organizations/:orgSlug/customers",...inside,requirePermission("customers.create"),validate({body:customerInput}),controller.createCustomer);
salesRoutes.patch("/organizations/:orgSlug/customers/:id",authenticate,validate({params:salesIdParams,body:customerUpdateInput}),requireOrganization,requirePermission("customers.update"),controller.updateCustomer);
salesRoutes.get("/organizations/:orgSlug/customers/:id/detail",authenticate,validate({params:salesIdParams}),requireOrganization,requirePermission("customers.read"),controller.customerDetail);
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

/* Printable PDF documents — same permissions and scope as the matching reads. */
salesRoutes.get("/organizations/:orgSlug/customers/:id/statement.pdf",authenticate,validate({params:salesIdParams,query:pdfPeriodQuery}),requireOrganization,requirePermission("customers.read"),controller.customerStatementPdf);
salesRoutes.get("/organizations/:orgSlug/sales/invoices/:id/export.pdf",authenticate,validate({params:salesIdParams,query:pdfPeriodQuery}),requireOrganization,requirePermission("sales.read"),controller.invoicePdf);
salesRoutes.get("/organizations/:orgSlug/sales/orders/:orderId/invoice.pdf",authenticate,validate({params:salesOrderParams,query:pdfPeriodQuery}),requireOrganization,requirePermission("sales.read"),controller.orderInvoicePdf);
salesRoutes.get("/organizations/:orgSlug/sales/payments/:id/receipt.pdf",authenticate,validate({params:salesIdParams,query:pdfPeriodQuery}),requireOrganization,requirePermission("sales.read"),controller.paymentReceiptPdf);
salesRoutes.get("/organizations/:orgSlug/finance/sales-report.pdf",...inside,requirePermission("finance.transactions.read"),validate({query:pdfPeriodQuery}),controller.salesReportPdf);
