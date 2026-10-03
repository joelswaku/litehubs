import type { Request, RequestHandler } from "express";
import * as service from "./company-setup.service";
import * as websiteBuilder from "./website-builder.service";
import * as customerActivities from "./customer-activities.service";
import { BadRequestError } from "../../utils/errors";
import type {
  CreateDepartmentInput,
  CreateInvitationInput,
  CompanyRulesInput,
  CreateProvinceInput,
  CreateRoleInput,
  CreateSiteInput,
  ReplaceMemberProvincesInput,
  ReplaceMemberRolesInput,
  UpdateDepartmentInput,
  UpdateProvinceInput,
  UpdateRoleInput,
  UpdateSiteInput,
  WebsitePageCreateInput,
  WebsitePageOrderInput,
  WebsitePageUpdateInput,
  WebsiteSectionsInput,
  WebsiteSettingsInput,
  PublicWebsiteContactInput,
  CustomerActivityCreateInput,
  CustomerActivityShareInput,
  CustomerActivityUpdateInput,
} from "./company-setup.validation";

function contextOf(req: Request): service.SetupContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const listProvinces: RequestHandler = async (req, res) => {
  res.json({ provinces: await service.listProvinces(contextOf(req)) });
};

export const getCompanyRules: RequestHandler = async (req, res) => {
  res.json({ policy: await service.currentCompanyRules(contextOf(req)) });
};

export const downloadCompanyRulesPdf: RequestHandler = async (req, res) => {
  const french = String(req.query.lang ?? "fr").toLowerCase() !== "en";
  const pdf = await service.exportCompanyRulesPdf(contextOf(req), french);
  res
    .status(200)
    .type("application/pdf")
    .setHeader(
      "Content-Disposition",
      'attachment; filename="reglement-entreprise-congo-omega.pdf"',
    )
    .send(pdf);
};

export const listCompanyRulesVersions: RequestHandler = async (req, res) => {
  res.json({
    versions: await service.listCompanyRulesVersions(contextOf(req)),
  });
};

export const publishCompanyRules: RequestHandler = async (req, res) => {
  res.status(201).json({
    policy: await service.publishCompanyRules(
      contextOf(req),
      req.body as CompanyRulesInput,
    ),
  });
};

/* ----------------------------------------------------------- public site -- */

export const getWebsiteBuilder: RequestHandler = async (req, res) => {
  res.json(await websiteBuilder.getWebsiteBuilder(contextOf(req)));
};

export const saveWebsiteSettings: RequestHandler = async (req, res) => {
  res.json({
    website: await websiteBuilder.saveWebsiteSettings(
      contextOf(req),
      req.body as WebsiteSettingsInput,
    ),
  });
};

export const listWebsiteMedia: RequestHandler = async (req, res) => {
  res.json({ media: await websiteBuilder.listWebsiteMedia(contextOf(req)) });
};

export const uploadWebsiteMedia: RequestHandler = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length)
    throw new BadRequestError("Choose at least one image to upload");
  res
    .status(201)
    .json({
      media: await websiteBuilder.uploadWebsiteMedia(contextOf(req), files),
    });
};

export const deleteWebsiteMedia: RequestHandler = async (req, res) => {
  await websiteBuilder.deleteWebsiteMedia(
    contextOf(req),
    parameter(req, "mediaId"),
  );
  res.status(204).send();
};

export const createWebsitePage: RequestHandler = async (req, res) => {
  res.status(201).json({
    page: await websiteBuilder.createWebsitePage(
      contextOf(req),
      req.body as WebsitePageCreateInput,
    ),
  });
};

export const reorderWebsitePages: RequestHandler = async (req, res) => {
  res.json(
    await websiteBuilder.reorderWebsitePages(
      contextOf(req),
      req.body as WebsitePageOrderInput,
    ),
  );
};

export const addWebsiteStarterPages: RequestHandler = async (req, res) => {
  res.status(201).json({
    pages: await websiteBuilder.addWebsiteStarterPages(contextOf(req)),
  });
};

export const completeWebsiteStarterPages: RequestHandler = async (req, res) => {
  res.json(await websiteBuilder.completeWebsiteStarterPages(contextOf(req)));
};

export const addWebsiteVisualHighlights: RequestHandler = async (req, res) => {
  res.json(await websiteBuilder.addWebsiteVisualHighlights(contextOf(req)));
};

export const updateWebsitePage: RequestHandler = async (req, res) => {
  res.json({
    page: await websiteBuilder.updateWebsitePage(
      contextOf(req),
      parameter(req, "pageId"),
      req.body as WebsitePageUpdateInput,
    ),
  });
};

export const replaceWebsiteSections: RequestHandler = async (req, res) => {
  res.json({
    page: await websiteBuilder.replaceWebsiteSections(
      contextOf(req),
      parameter(req, "pageId"),
      req.body as WebsiteSectionsInput,
    ),
  });
};

export const publishWebsitePage: RequestHandler = async (req, res) => {
  res.json({
    page: await websiteBuilder.publishWebsitePage(
      contextOf(req),
      parameter(req, "pageId"),
    ),
  });
};

export const archiveWebsitePage: RequestHandler = async (req, res) => {
  await websiteBuilder.archiveWebsitePage(
    contextOf(req),
    parameter(req, "pageId"),
  );
  res.status(204).send();
};

export const setWebsitePublication: RequestHandler = async (req, res) => {
  res.json({
    website: await websiteBuilder.setWebsitePublication(
      contextOf(req),
      req.body.status as "published" | "draft" | "paused",
    ),
  });
};

export const listCustomerActivities: RequestHandler = async (req, res) => {
  res.json({ activities: await customerActivities.listCustomerActivities(contextOf(req)) });
};

export const createCustomerActivity: RequestHandler = async (req, res) => {
  res.status(201).json({
    activity: await customerActivities.createCustomerActivity(
      contextOf(req),
      req.body as CustomerActivityCreateInput,
    ),
  });
};

export const updateCustomerActivity: RequestHandler = async (req, res) => {
  res.json({
    activity: await customerActivities.updateCustomerActivity(
      contextOf(req),
      parameter(req, "activityId"),
      req.body as CustomerActivityUpdateInput,
    ),
  });
};

export const archiveCustomerActivity: RequestHandler = async (req, res) => {
  await customerActivities.archiveCustomerActivity(
    contextOf(req),
    parameter(req, "activityId"),
  );
  res.status(204).send();
};

export const shareCustomerActivity: RequestHandler = async (req, res) => {
  res.status(202).json(
    await customerActivities.shareCustomerActivity(
      contextOf(req),
      parameter(req, "activityId"),
      req.body as CustomerActivityShareInput,
    ),
  );
};

export const publicWebsite: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(
    await websiteBuilder.publicWebsitePage(
      parameter(req, "orgSlug"),
      req.params.pageSlug ? parameter(req, "pageSlug") : undefined,
    ),
  );
};

/** Same restricted public response, selected by the browser's verified custom
 * domain rather than a LiteHubs organisation slug. */
export const publicWebsiteDomain: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(
    await websiteBuilder.publicWebsitePage(
      parameter(req, "domain"),
      req.params.pageSlug ? parameter(req, "pageSlug") : undefined,
    ),
  );
};

/** Delivers a public-site inquiry to the recipient configured for the verified
 * domain. The visitor never chooses the recipient from the browser. */
export const sendPublicWebsiteContact: RequestHandler = async (req, res) => {
  await websiteBuilder.sendPublicWebsiteContact(
    parameter(req, "domain"),
    req.body as PublicWebsiteContactInput,
  );
  res.status(201).json({ message: "Website message sent" });
};

export const createProvince: RequestHandler = async (req, res) => {
  const province = await service.createProvince(
    contextOf(req),
    req.body as CreateProvinceInput,
  );
  res.status(201).json({ province });
};

export const updateProvince: RequestHandler = async (req, res) => {
  const province = await service.updateProvince(
    contextOf(req),
    parameter(req, "provinceId"),
    req.body as UpdateProvinceInput,
  );
  res.json({ province });
};

export const deleteProvince: RequestHandler = async (req, res) => {
  await service.deleteProvince(contextOf(req), parameter(req, "provinceId"));
  res.status(204).send();
};

export const listSites: RequestHandler = async (req, res) => {
  res.json({ sites: await service.listSites(contextOf(req)) });
};

export const createSite: RequestHandler = async (req, res) => {
  const site = await service.createSite(
    contextOf(req),
    req.body as CreateSiteInput,
  );
  res.status(201).json({ site });
};

export const updateSite: RequestHandler = async (req, res) => {
  const site = await service.updateSite(
    contextOf(req),
    parameter(req, "siteId"),
    req.body as UpdateSiteInput,
  );
  res.json({ site });
};

export const deleteSite: RequestHandler = async (req, res) => {
  await service.deleteSite(contextOf(req), parameter(req, "siteId"));
  res.status(204).send();
};

export const listDepartments: RequestHandler = async (req, res) => {
  res.json({ departments: await service.listDepartments(contextOf(req)) });
};

export const createDepartment: RequestHandler = async (req, res) => {
  const department = await service.createDepartment(
    contextOf(req),
    req.body as CreateDepartmentInput,
  );
  res.status(201).json({ department });
};

export const updateDepartment: RequestHandler = async (req, res) => {
  const department = await service.updateDepartment(
    contextOf(req),
    parameter(req, "departmentId"),
    req.body as UpdateDepartmentInput,
  );
  res.json({ department });
};

export const deleteDepartment: RequestHandler = async (req, res) => {
  await service.deleteDepartment(
    contextOf(req),
    parameter(req, "departmentId"),
  );
  res.status(204).send();
};

export const listRoles: RequestHandler = async (req, res) => {
  res.json({ roles: await service.listRoles(contextOf(req)) });
};

export const listPermissions: RequestHandler = async (req, res) => {
  res.json({ permissions: await service.listPermissions(contextOf(req)) });
};

export const createRole: RequestHandler = async (req, res) => {
  const role = await service.createRole(
    contextOf(req),
    req.body as CreateRoleInput,
  );
  res.status(201).json({ role });
};

export const updateRole: RequestHandler = async (req, res) => {
  const role = await service.updateRole(
    contextOf(req),
    parameter(req, "roleId"),
    req.body as UpdateRoleInput,
  );
  res.json({ role });
};

export const deleteRole: RequestHandler = async (req, res) => {
  await service.deleteRole(contextOf(req), parameter(req, "roleId"));
  res.status(204).send();
};

export const listMembers: RequestHandler = async (req, res) => {
  res.json({ members: await service.listMembers(contextOf(req)) });
};

export const replaceMemberRoles: RequestHandler = async (req, res) => {
  const assignment = await service.replaceMemberRoles(
    contextOf(req),
    parameter(req, "memberId"),
    req.body as ReplaceMemberRolesInput,
  );
  res.json({ assignment });
};

export const replaceMemberProvinces: RequestHandler = async (req, res) => {
  const assignment = await service.replaceMemberProvinces(
    contextOf(req),
    parameter(req, "memberId"),
    req.body as ReplaceMemberProvincesInput,
  );
  res.json({ assignment });
};

export const listInvitations: RequestHandler = async (req, res) => {
  res.json({ invitations: await service.listInvitations(contextOf(req)) });
};

export const createInvitation: RequestHandler = async (req, res) => {
  const result = await service.createInvitation(
    contextOf(req),
    req.body as CreateInvitationInput,
  );
  res.status(201).json(result);
};

export const revokeInvitation: RequestHandler = async (req, res) => {
  await service.revokeInvitation(
    contextOf(req),
    parameter(req, "invitationId"),
  );
  res.status(204).send();
};
