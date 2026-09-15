import PDFDocument from "pdfkit";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import * as employees from "./employee.service";
import * as attendance from "../attendance/attendance.service";
import * as leave from "../leave/leave.service";
import * as payroll from "../payroll/payroll.service";
import * as performance from "../performance/performance.service";
import * as discipline from "../discipline/discipline.service";

export const hrReportKinds = ["employee", "attendance", "leave", "payroll", "performance", "discipline"] as const;
export type HrReportKind = (typeof hrReportKinds)[number];
export interface HrReportContext { organizationId: string; userId: string; memberId: string; isOwner: boolean; permissions: string[]; }
const required: Record<HrReportKind, string> = { employee:"employees.read", attendance:"attendance.read", leave:"leave.read", payroll:"payroll.read", performance:"performance.read", discipline:"disciplinary_actions.read" };
const allow = (c: HrReportContext, p: string) => c.isOwner || c.permissions.includes(p);
const text = (v: unknown) => v === null || v === undefined || v === "" ? "—" : String(v);
const label = (fr: boolean, en: string, french: string) => fr ? french : en;
const pretty = (v: unknown) => text(v).replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase());
const date = (v: unknown, fr: boolean) => { if (!v) return "—"; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? text(v) : new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", { dateStyle:"medium" }).format(d); };
const money = (v: unknown, currency: unknown, fr: boolean) => new Intl.NumberFormat(fr ? "fr-FR" : "en-US", { style:"currency", currency:/^[A-Z]{3}$/.test(String(currency ?? "")) ? String(currency) : "USD" }).format(Number(v ?? 0));

function addPage(doc: PDFKit.PDFDocument) { if (doc.y > 720) { doc.addPage(); doc.y = 48; } }
function title(doc: PDFKit.PDFDocument, name: string, report: string) {
  doc.rect(0,0,doc.page.width,88).fill("#10243f");
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text(name,48,30);
  doc.fillColor("#bed8f7").font("Helvetica").fontSize(9).text("LiteHubs · Document RH confidentiel",48,57);
  doc.fillColor("#10243f").font("Helvetica-Bold").fontSize(16).text(report,48,113);
  doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date()),48,138);
  doc.y=164;
}
function section(doc: PDFKit.PDFDocument, name: string) { addPage(doc); doc.moveTo(48,doc.y).lineTo(doc.page.width-48,doc.y).strokeColor("#d8e3ef").stroke(); doc.moveDown(.6).fillColor("#10243f").font("Helvetica-Bold").fontSize(11).text(name); doc.moveDown(.35); }
function line(doc: PDFKit.PDFDocument, key: string, value: unknown) { addPage(doc); const y=doc.y; doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text(key,48,y,{width:150}); doc.fillColor("#1e293b").font("Helvetica").fontSize(9).text(text(value),202,y,{width:345}); doc.y=Math.max(doc.y,y+14)+4; }
function rows(doc: PDFKit.PDFDocument, heading: string, values: string[]) { section(doc,heading); if (!values.length) { doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(9).text("—"); return; } values.slice(0,100).forEach(v=>{ addPage(doc); doc.fillColor("#1e293b").font("Helvetica").fontSize(8.5).text("• "+v,54,doc.y,{width:500}); doc.moveDown(.35); }); }

async function org(c: HrReportContext) {
  return withTenantContext(c, async (client) =>
    (
      await client.query<{ name: string }>(
        "SELECT COALESCE(display_name, legal_name, slug) AS name FROM organizations WHERE id=$1",
        [c.organizationId],
      )
    ).rows[0]?.name ?? "LiteHubs",
  );
}
function create(organization: string, report: string, draw: (doc: PDFKit.PDFDocument)=>Promise<void>) {
  return new Promise<Buffer>((resolve,reject)=>{ const doc=new PDFDocument({size:"A4",margin:48,info:{Title:report,Author:organization}}); const chunks:Buffer[]=[]; doc.on("data",(c:Buffer)=>chunks.push(c)); doc.on("end",()=>resolve(Buffer.concat(chunks))); doc.on("error",reject); title(doc,organization,report); void draw(doc).then(()=>{ doc.fillColor("#64748b").fontSize(7).text(organization+" · LiteHubs · Confidentiel",48,doc.page.height-34,{width:doc.page.width-96,align:"center"}); doc.end(); },reject); }); }
async function contractRows(c: HrReportContext, employeeId:string) { return withTenantContext(c,async client=>(await client.query<{reference:string;title:string;status:string;starts_on:string;ends_on:string|null}>("SELECT reference,title,status,starts_on::text,ends_on::text FROM contracts WHERE organization_id=$1 AND employee_id=$2 ORDER BY starts_on DESC",[c.organizationId,employeeId])).rows); }

async function employeePdf(c: HrReportContext, id:string, fr:boolean, organization:string) {
 const employee=await employees.getEmployee(c,id);
 const present=allow(c,"attendance.read")?await attendance.listAttendance(c,{employeeId:id}):[];
 const leaves=allow(c,"leave.read")?await leave.listRequests(c,{employeeId:id}):[];
 const reviews=allow(c,"performance.read")?await performance.listReviews(c,{employeeId:id}):[];
 const actions=allow(c,"disciplinary_actions.read")?await discipline.listActions(c,{employeeId:id}):[];
 const pay=allow(c,"payroll.read")?(await payroll.listCompensations(c)).filter(x=>x.employee.id===id):[];
 const contracts=allow(c,"contracts.read")?await contractRows(c,id):[];
 return create(organization,label(fr,"Employee dossier","Fiche employé complète"),async doc=>{
  section(doc,label(fr,"Identity and employment","Identité et emploi"));
  [["Employee number","Matricule",employee.employeeNumber],["Full name","Nom complet",employee.fullName],["Job title","Poste",employee.jobTitle],["Position level","Niveau de fonction",pretty(employee.positionCategory)],["Employment status","Statut d’emploi",pretty(employee.employment.status)],["Contract type","Type de contrat",pretty(employee.employment.type)],["Start date","Date de début",date(employee.employment.startDate,fr)],["Province","Province",employee.province?.name],["Site / farm","Site / ferme",employee.site?.name],["Department","Département",employee.department?.name],["Professional email","E-mail professionnel",employee.member?.email],["Phone","Téléphone",employee.contact.phone],["Emergency contact","Contact d’urgence",employee.contact.emergencyContactName],["Emergency phone","Téléphone d’urgence",employee.contact.emergencyContactPhone]].forEach(([en,french,v])=>line(doc,label(fr,String(en),String(french)),v));
  rows(doc,label(fr,"Recent attendance and schedules","Présence et horaires récents"),present.map(x=>date(x.workDate,fr)+" · "+text(x.shift?.name)+" · "+pretty(x.status)+" · "+date(x.clockInAt,fr)+" – "+date(x.clockOutAt,fr)));
  if(allow(c,"leave.read")) rows(doc,label(fr,"Leave","Congés"),leaves.map(x=>x.leaveType.name+" · "+date(x.startsOn,fr)+" – "+date(x.endsOn,fr)+" · "+x.requestedDays+" · "+pretty(x.status)));
  if(allow(c,"payroll.read")) rows(doc,label(fr,"Compensation","Rémunération"),pay.map(x=>date(x.effectiveFrom,fr)+" · "+money(x.basicSalary,x.currency,fr)+" · "+pretty(x.payFrequency)+" · "+pretty(x.paymentMethod)));
  if(allow(c,"performance.read")) rows(doc,label(fr,"Performance reviews","Évaluations de performance"),reviews.map(x=>date(x.periodStart,fr)+" – "+date(x.periodEnd,fr)+" · "+pretty(x.reviewType)+" · "+text(x.overallRating)+" · "+pretty(x.status)));
  if(allow(c,"disciplinary_actions.read")) rows(doc,label(fr,"Disciplinary record","Dossier disciplinaire"),actions.map(x=>date(x.occurredOn,fr)+" · "+pretty(x.category)+" · "+pretty(x.severity)+" · "+pretty(x.status)));
  if(allow(c,"contracts.read")) rows(doc,label(fr,"Employment contracts","Contrats de travail"),contracts.map(x=>x.reference+" · "+x.title+" · "+date(x.starts_on,fr)+" – "+date(x.ends_on,fr)+" · "+pretty(x.status)));
 });
}
export async function exportHrReport(c: HrReportContext, kind:HrReportKind, options:{employeeId?:string;french?:boolean}) {
 if(!allow(c,required[kind])) throw new ForbiddenError("You do not have permission to export this HR report");
 const fr=options.french ?? true, organization=await org(c);
 if(kind==="employee") { if(!options.employeeId) throw new BadRequestError("Choose an employee before downloading the dossier",{field:"employeeId"}); return employeePdf(c,options.employeeId,fr,organization); }
 const report={attendance:label(fr,"Attendance and schedules","Présence et horaires"),leave:label(fr,"Leave register","Registre des congés"),payroll:label(fr,"Payroll register","Registre de paie"),performance:label(fr,"Performance reviews","Évaluations de performance"),discipline:label(fr,"Disciplinary actions","Actions disciplinaires")}[kind];
 return create(organization,report,async doc=>{
  if(kind==="attendance") { const data=await attendance.listAttendance(c,{}); rows(doc,report,data.map(x=>x.employee.fullName+" · #"+x.employee.employeeNumber+" · "+date(x.workDate,fr)+" · "+text(x.shift?.name)+" · "+pretty(x.status)+" · "+date(x.clockInAt,fr)+" – "+date(x.clockOutAt,fr))); return; }
  if(kind==="leave") { const data=await leave.listRequests(c,{}); rows(doc,report,data.map(x=>x.employee.fullName+" · #"+x.employee.employeeNumber+" · "+x.leaveType.name+" · "+date(x.startsOn,fr)+" – "+date(x.endsOn,fr)+" · "+x.requestedDays+" · "+pretty(x.status))); return; }
  if(kind==="payroll") { const data=await payroll.listRuns(c,{}); rows(doc,report,data.map(x=>x.reference+" · "+date(x.periodStart,fr)+" – "+date(x.periodEnd,fr)+" · "+x.employeeCount+" · "+money(x.netTotal,x.currency,fr)+" · "+pretty(x.status))); return; }
  if(kind==="performance") { const data=await performance.listReviews(c,{}); rows(doc,report,data.map(x=>x.employee.fullName+" · #"+x.employee.employeeNumber+" · "+date(x.periodStart,fr)+" – "+date(x.periodEnd,fr)+" · "+pretty(x.reviewType)+" · "+text(x.overallRating)+" · "+pretty(x.status))); return; }
  const data=await discipline.listActions(c,{}); rows(doc,report,data.map(x=>x.employee.fullName+" · #"+x.employee.employeeNumber+" · "+date(x.occurredOn,fr)+" · "+pretty(x.category)+" · "+pretty(x.severity)+" · "+pretty(x.status)));
 });
}
export function assertHrReportKind(value:string):asserts value is HrReportKind { if(!(hrReportKinds as readonly string[]).includes(value)) throw new NotFoundError("HR report not found"); }
