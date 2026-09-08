import type { Request, RequestHandler } from "express";
import * as service from "./contracts.service";
import type { ContractQuery, CreateContractInput, SignEmploymentContractInput, UpdateContractInput, ContractTemplateInput, GenerateContractVersionInput, SendForSignatureInput, SignContractFieldInput } from "./contracts.validation";

function context(req: Request): service.ContractsContext {
  return { organizationId: req.organization!.id, userId: req.user!.id, memberId: req.membership!.memberId, isOwner: req.membership!.isOwner, permissions: req.membership!.permissions };
}
function param(req: Request, key: string) { const value = req.params[key]; return Array.isArray(value) ? (value[0] ?? "") : (value ?? ""); }
export const listContracts: RequestHandler = async (req, res) => res.json({ contracts: await service.listContracts(context(req), req.query as ContractQuery) });
export const createContract: RequestHandler = async (req, res) => res.status(201).json({ contract: await service.createContract(context(req), req.body as CreateContractInput) });
export const updateContract: RequestHandler = async (req, res) => res.json({ contract: await service.updateContract(context(req), param(req, "contractId"), req.body as UpdateContractInput) });
export const deleteContract: RequestHandler = async (req, res) => { await service.deleteContract(context(req), param(req, "contractId")); res.status(204).send(); };
export const summary: RequestHandler = async (req, res) => res.json(await service.summary(context(req)));
export const listMyContracts: RequestHandler = async (req, res) =>
  res.json({ contracts: await service.listMyContracts(context(req)) });

export const downloadMyContractDocument: RequestHandler = async (req, res) => {
  const file = await service.myContractDocument(context(req), param(req, "contractId"));
  res.type(file.document.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.document.fileName.replace(/[\r\n"]/g, "")}"`,
  );
  res.send(file.buffer);
};
export const previewMyContractDocument: RequestHandler = async (req, res) => {
  const file = await service.myContractDocument(context(req), param(req, "contractId"), { regenerateLayout: true });
  res.type(file.document.mimeType);
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${file.document.fileName.replace(/[\r\n"]/g, "")}"`,
  );
  res.send(file.buffer);
};

export const signMyEmploymentContract: RequestHandler = async (req, res) =>
  res.json({
    contract: await service.signMyEmploymentContract(
      context(req),
      param(req, "contractId"),
      req.body as SignEmploymentContractInput,
    ),
  });
export const listTemplates: RequestHandler = async (req, res) => res.json({ templates: await service.listContractTemplates(context(req)) });
export const createTemplate: RequestHandler = async (req, res) => res.status(201).json({ template: await service.createContractTemplate(context(req), req.body as ContractTemplateInput) });
export const updateTemplate: RequestHandler = async (req, res) => res.json({ template: await service.updateContractTemplate(context(req), param(req, "templateId"), req.body as ContractTemplateInput) });
export const workspace: RequestHandler = async (req, res) => res.json(await service.contractWorkspace(context(req), param(req, "contractId")));
export const generateVersion: RequestHandler = async (req, res) => res.status(201).json(await service.generateContractDocumentVersion(context(req), param(req, "contractId"), req.body as GenerateContractVersionInput));
export const sendForSignature: RequestHandler = async (req, res) => res.json(await service.sendContractForSignature(context(req), param(req, "contractId"), req.body as SendForSignatureInput));
export const remindSignature: RequestHandler = async (req, res) => res.json(
  await service.remindContractSignature(context(req), param(req, "contractId")),
);
export const myWorkspace: RequestHandler = async (req, res) => res.json(await service.myContractWorkspace(context(req), param(req, "contractId")));
export const signEmployeeField: RequestHandler = async (req, res) => res.json(await service.signContractSignatureField(context(req), param(req, "contractId"), param(req, "fieldId"), req.body as SignContractFieldInput, "employee"));
export const signEmployerField: RequestHandler = async (req, res) => res.json(await service.signContractSignatureField(context(req), param(req, "contractId"), param(req, "fieldId"), req.body as SignContractFieldInput, "employer"));
export const previewWorkspaceDocument: RequestHandler = async (req, res) => {
  const file = await service.contractWorkspaceDocument(context(req), param(req, "contractId"), { regenerateLayout: true });
  res.type(file.document.mimeType);
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("Content-Disposition", `inline; filename="${file.document.fileName.replace(/[\r\n"]/g, "")}"`);
  res.send(file.buffer);
};
export const downloadWorkspaceDocument: RequestHandler = async (req, res) => { const file=await service.contractWorkspaceDocument(context(req),param(req,"contractId")); res.type(file.document.mimeType); res.setHeader("Content-Disposition",`attachment; filename="${file.document.fileName.replace(/[\r\n"]/g, "")}"`); res.send(file.buffer); };