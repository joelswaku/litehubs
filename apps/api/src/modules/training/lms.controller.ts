import type { Request, RequestHandler } from "express";
import PDFDocument from "pdfkit";
import * as lms from "./lms.service";
import * as trainingAi from "./training-ai.service";
import type { TrainingContext } from "./training.service";
import type {
  CreateBlockInput,
  CreateLessonInput,
  CreateModuleInput,
  CreateProfessionalCourseInput,
  UpdateBlockInput,
  LearnerBlockProgressInput,
  TrainingAiAssistantInput,
  ApplyAiOutlineInput,
} from "./lms.validation";

function context(req: Request): TrainingContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
const param = (req: Request, key: string) =>
  Array.isArray(req.params[key])
    ? req.params[key]![0]!
    : (req.params[key] ?? "");

export const createCourse: RequestHandler = async (req, res) =>
  res.status(201).json({
    course: await lms.createProfessionalCourse(
      context(req),
      req.body as CreateProfessionalCourseInput,
    ),
  });
export const builder: RequestHandler = async (req, res) =>
  res.json(
    await lms.courseBuilder(
      context(req),
      param(req, "courseId"),
      typeof req.query.versionId === "string" ? req.query.versionId : undefined,
    ),
  );
export const addModule: RequestHandler = async (req, res) =>
  res.status(201).json({
    module: await lms.addModule(
      context(req),
      param(req, "courseId"),
      req.body as CreateModuleInput,
    ),
  });
export const addLesson: RequestHandler = async (req, res) =>
  res.status(201).json({
    lesson: await lms.addLesson(
      context(req),
      param(req, "moduleId"),
      req.body as CreateLessonInput,
    ),
  });
export const addBlock: RequestHandler = async (req, res) =>
  res.status(201).json({
    block: await lms.addBlock(
      context(req),
      param(req, "lessonId"),
      req.body as CreateBlockInput,
    ),
  });
export const updateBlock: RequestHandler = async (req, res) =>
  res.json({
    block: await lms.updateBlock(
      context(req),
      param(req, "blockId"),
      req.body as UpdateBlockInput,
    ),
  });
export const deleteBlock: RequestHandler = async (req, res) => {
  await lms.deleteBlock(context(req), param(req, "blockId"));
  res.status(204).send();
};
export const publish: RequestHandler = async (req, res) =>
  res.json(
    await lms.publishCourse(
      context(req),
      param(req, "courseId"),
      param(req, "versionId"),
      req.body as { changeSummary?: string | null; requiresRetake: boolean },
    ),
  );
export const importAiOutline: RequestHandler = async (req, res) =>
  res.status(201).json(
    await lms.importAiOutline(
      context(req),
      param(req, "courseId"),
      req.body as ApplyAiOutlineInput,
    ),
  );
export const learnerCourse: RequestHandler = async (req, res) =>
  res.json(await lms.learnerCourse(context(req), param(req, "assignmentId")));
export const learnerBlockProgress: RequestHandler = async (req, res) =>
  res.json(
    await lms.recordLearnerBlockProgress(
      context(req),
      param(req, "assignmentId"),
      param(req, "blockId"),
      req.body as LearnerBlockProgressInput,
    ),
  );

export const submitQuiz: RequestHandler = async (req, res) =>
  res.json(
    await lms.submitLearnerQuiz(
      context(req),
      param(req, "assignmentId"),
      param(req, "blockId"),
      (req.body as { answers: unknown[] }).answers,
    ),
  );
export const validateAssignment: RequestHandler = async (req, res) =>
  res.json(
    await lms.validateProfessionalAssignment(
      context(req),
      param(req, "assignmentId"),
      Boolean((req.body as { approved: boolean }).approved),
      (req.body as { note?: string | null }).note,
    ),
  );
export const learnerBlockFile: RequestHandler = async (req, res) => {
  const file = await lms.learnerBlockFile(
    context(req),
    param(req, "assignmentId"),
    param(req, "blockId"),
  );
  res.type(file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "true" && file.allowDownload ? "attachment" : "inline"}; filename="${file.fileName.replace(/[\r\n"]/g, "")}"`,
  );
  res.send(file.buffer);
};
export const createRevision: RequestHandler = async (req, res) =>
  res.status(201).json({
    revision: await lms.createCourseRevision(
      context(req),
      param(req, "courseId"),
    ),
  });

export const aiDraft: RequestHandler = async (req, res) =>
  res.json(
    await trainingAi.createTrainingAiDraft(
      context(req),
      req.body as TrainingAiAssistantInput,
    ),
  );
export const publicCertificateVerification: RequestHandler = async (req, res) =>
  res.json(await lms.verifyCertificate(param(req, "token")));

export const learnerCertificatePdf: RequestHandler = async (req, res) => {
  const item = await lms.learnerCertificateFileInfo(
    context(req),
    param(req, "assignmentId"),
  );
  const certificate = item.certificate;
  const companyName = String(certificate.organizationName || "Entreprise").trim() || "Entreprise";
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 52, bottom: 52, left: 58, right: 58 },
      info: {
        Title: `${certificate.courseName} certificate`,
        Author: companyName,
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    const width = pdf.page.width;
    const height = pdf.page.height;
    pdf.rect(0, 0, width, height).fill("#F8FBFA");
    pdf
      .lineWidth(5)
      .strokeColor("#1B5E4B")
      .rect(24, 24, width - 48, height - 48)
      .stroke();
    pdf
      .fillColor("#1B5E4B")
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(companyName.toLocaleUpperCase("fr-FR").slice(0, 72), 0, 72, { align: "center" });
    pdf
      .fillColor("#19352D")
      .font("Helvetica-Bold")
      .fontSize(33)
      .text("CERTIFICAT DE FORMATION", 0, 112, { align: "center" });
    pdf
      .fillColor("#58726B")
      .font("Helvetica")
      .fontSize(13)
      .text("Ce certificat atteste que", 0, 174, { align: "center" });
    pdf
      .fillColor("#19352D")
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(certificate.employeeName, 0, 205, { align: "center" });
    pdf
      .fillColor("#58726B")
      .font("Helvetica")
      .fontSize(11)
      .text(
        `Employé #${certificate.employeeNumber} · ${certificate.organizationName}`,
        0,
        245,
        { align: "center" },
      );
    pdf
      .fillColor("#58726B")
      .fontSize(13)
      .text("a complété avec succès la formation", 0, 286, { align: "center" });
    pdf
      .fillColor("#19352D")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(certificate.courseName, 0, 316, { align: "center" });
    pdf
      .fillColor("#58726B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Code : ${certificate.courseCode}${certificate.score === null ? "" : ` · Score : ${certificate.score}%`}`,
        0,
        347,
        { align: "center" },
      );
    const issued = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
    }).format(certificate.issuedAt);
    pdf
      .fillColor("#58726B")
      .fontSize(10)
      .text(
        `Délivré le ${issued}${certificate.expiresOn ? ` · Expire le ${certificate.expiresOn}` : ""}`,
        0,
        402,
        { align: "center" },
      );
    pdf
      .fillColor("#19352D")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`N° ${certificate.number}`, 60, height - 100);
    pdf
      .font("Helvetica")
      .fillColor("#58726B")
      .fontSize(8)
      .text(
        `Vérification : /api/v1/training-certificates/verify/${certificate.verificationToken}`,
        60,
        height - 82,
      );
    pdf
      .fillColor("#19352D")
      .font("Helvetica")
      .fontSize(9)
      .text(
        certificate.approvedByName ?? companyName,
        width - 210,
        height - 100,
        { width: 150, align: "right" },
      );
    pdf
      .fillColor("#58726B")
      .fontSize(8)
      .text("Autorisation de formation", width - 210, height - 82, {
        width: 150,
        align: "right",
      });
    pdf.end();
  });
  res.type("application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${certificate.number.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
  );
  res.send(buffer);
};
