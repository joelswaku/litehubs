import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requireOwner } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./personal-finance.controller";
import {
  categoryBody,
  categoryUpdateBody,
  debtBody,
  debtUpdateBody,
  organizationParams,
  recordParams,
  recurringBody,
  recurringUpdateBody,
  settingsBody,
  summaryQuery,
  transactionBody,
  transactionUpdateBody,
} from "./personal-finance.validation";

/** "Mes finances": the workspace owner's private money. Owner only. */
export const personalFinanceRoutes = Router();
const base = "/organizations/:orgSlug/personal-finance";
const owner = [authenticate, requireOrganization, requireOwner];

personalFinanceRoutes.get(base, ...owner, validate({ params: organizationParams, query: summaryQuery }), controller.summary);
personalFinanceRoutes.put(`${base}/settings`, ...owner, validate({ params: organizationParams, body: settingsBody }), controller.saveSettings);

personalFinanceRoutes.post(`${base}/categories`, ...owner, validate({ params: organizationParams, body: categoryBody }), controller.createCategory);
personalFinanceRoutes.patch(`${base}/categories/:id`, ...owner, validate({ params: recordParams, body: categoryUpdateBody }), controller.updateCategory);

personalFinanceRoutes.post(`${base}/transactions`, ...owner, validate({ params: organizationParams, body: transactionBody }), controller.createTransaction);
personalFinanceRoutes.patch(`${base}/transactions/:id`, ...owner, validate({ params: recordParams, body: transactionUpdateBody }), controller.updateTransaction);
personalFinanceRoutes.delete(`${base}/transactions/:id`, ...owner, validate({ params: recordParams }), controller.deleteTransaction);

personalFinanceRoutes.post(`${base}/debts`, ...owner, validate({ params: organizationParams, body: debtBody }), controller.createDebt);
personalFinanceRoutes.patch(`${base}/debts/:id`, ...owner, validate({ params: recordParams, body: debtUpdateBody }), controller.updateDebt);
personalFinanceRoutes.delete(`${base}/debts/:id`, ...owner, validate({ params: recordParams }), controller.deleteDebt);

personalFinanceRoutes.post(`${base}/recurring`, ...owner, validate({ params: organizationParams, body: recurringBody }), controller.createRecurring);
personalFinanceRoutes.patch(`${base}/recurring/:id`, ...owner, validate({ params: recordParams, body: recurringUpdateBody }), controller.updateRecurring);
personalFinanceRoutes.delete(`${base}/recurring/:id`, ...owner, validate({ params: recordParams }), controller.deleteRecurring);
personalFinanceRoutes.post(`${base}/recurring/:id/record`, ...owner, validate({ params: recordParams, query: summaryQuery }), controller.recordRecurring);
