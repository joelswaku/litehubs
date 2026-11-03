import type { Request, RequestHandler } from "express";
import * as service from "./personal-finance.service";
import {
  summaryQuery,
  type CategoryInput,
  type CategoryUpdateInput,
  type DebtInput,
  type DebtUpdateInput,
  type RecurringInput,
  type RecurringUpdateInput,
  type SettingsInput,
  type TransactionInput,
  type TransactionUpdateInput,
} from "./personal-finance.validation";

const context = (req: Request): service.FinanceContext => ({ organizationId: req.organization!.id, userId: req.user!.id });
const id = (req: Request) => String(req.params.id);
const noStore = (res: Parameters<RequestHandler>[1]) => res.setHeader("Cache-Control", "private, no-store, max-age=0");

export const summary: RequestHandler = async (req, res) => {
  noStore(res);
  res.json(await service.summary(context(req), summaryQuery.parse(req.query).month));
};
export const saveSettings: RequestHandler = async (req, res) =>
  res.json(await service.saveSettings(context(req), req.body as SettingsInput));

export const createCategory: RequestHandler = async (req, res) =>
  res.status(201).json(await service.createCategory(context(req), req.body as CategoryInput));
export const updateCategory: RequestHandler = async (req, res) =>
  res.json(await service.updateCategory(context(req), id(req), req.body as CategoryUpdateInput));

export const createTransaction: RequestHandler = async (req, res) =>
  res.status(201).json(await service.createTransaction(context(req), req.body as TransactionInput));
export const updateTransaction: RequestHandler = async (req, res) =>
  res.json(await service.updateTransaction(context(req), id(req), req.body as TransactionUpdateInput));
export const deleteTransaction: RequestHandler = async (req, res) =>
  res.json(await service.deleteTransaction(context(req), id(req)));

export const createDebt: RequestHandler = async (req, res) =>
  res.status(201).json(await service.createDebt(context(req), req.body as DebtInput));
export const updateDebt: RequestHandler = async (req, res) =>
  res.json(await service.updateDebt(context(req), id(req), req.body as DebtUpdateInput));
export const deleteDebt: RequestHandler = async (req, res) => res.json(await service.deleteDebt(context(req), id(req)));

export const createRecurring: RequestHandler = async (req, res) =>
  res.status(201).json(await service.createRecurring(context(req), req.body as RecurringInput));
export const updateRecurring: RequestHandler = async (req, res) =>
  res.json(await service.updateRecurring(context(req), id(req), req.body as RecurringUpdateInput));
export const deleteRecurring: RequestHandler = async (req, res) =>
  res.json(await service.deleteRecurring(context(req), id(req)));
export const recordRecurring: RequestHandler = async (req, res) =>
  res.status(201).json(await service.recordRecurring(context(req), id(req), summaryQuery.parse(req.query).month));
