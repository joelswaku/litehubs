import type { Request, RequestHandler } from "express";
import * as service from "./sales.service";
import type { CreateOrderInput, CustomerInput, DeliveryInput, OfferInput, PaymentInput, SalesListQuery } from "./sales.validation";

function context(req: Request): service.SalesContext {
  return { organizationId: req.organization!.id, userId: req.user!.id, memberId: req.membership!.memberId, isOwner: req.membership!.isOwner, permissions: req.membership!.permissions };
}
function param(req: Request, key: string) { const value=req.params[key]; return Array.isArray(value)?(value[0]??""):(value??""); }

export const customers: RequestHandler = async (req,res)=>res.json({ customers:await service.listCustomers(context(req),req.query as unknown as SalesListQuery) });
export const createCustomer: RequestHandler = async (req,res)=>res.status(201).json({ customer:await service.createCustomer(context(req),req.body as CustomerInput) });
export const sources: RequestHandler = async (req,res)=>res.json({ sources:await service.listSellableSources(context(req)) });
export const warehouses: RequestHandler = async (req,res)=>res.json({ warehouses:await service.listSalesWarehouses(context(req)) });
export const productionSummary: RequestHandler = async (req,res)=>res.json({ production:await service.productionSummary(context(req)) });
export const offers: RequestHandler = async (req,res)=>res.json({ offers:await service.listOffers(context(req),req.query as unknown as SalesListQuery) });
export const createOffer: RequestHandler = async (req,res)=>res.status(201).json({ offer:await service.createOffer(context(req),req.body as OfferInput) });
export const orders: RequestHandler = async (req,res)=>res.json({ orders:await service.listOrders(context(req),req.query as unknown as SalesListQuery) });
export const createOrder: RequestHandler = async (req,res)=>res.status(201).json({ order:await service.createOrder(context(req),req.body as CreateOrderInput) });
export const confirmOrder: RequestHandler = async (req,res)=>res.json({ order:await service.confirmOrder(context(req),param(req,"orderId")) });
export const deliverOrder: RequestHandler = async (req,res)=>res.status(201).json({ delivery:await service.deliverOrder(context(req),param(req,"orderId"),req.body as DeliveryInput) });
export const invoiceOrder: RequestHandler = async (req,res)=>res.status(201).json({ invoice:await service.invoiceOrder(context(req),param(req,"orderId")) });
export const payments: RequestHandler = async (req,res)=>res.json({ payments:await service.listPayments(context(req),req.query as unknown as SalesListQuery) });
export const receivePayment: RequestHandler = async (req,res)=>res.status(201).json({ payment:await service.receivePayment(context(req),req.body as PaymentInput) });
export const financeSummary: RequestHandler = async (req,res)=>res.json({ summary:await service.financeSummary(context(req)) });
