import type { PoolClient } from "pg";
import { withTenantContext } from "../../utils/tenant-query";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import type { TrainingContext } from "./training.service";
import * as lms from "./lms.service";
import type {
  CourseAudienceInput,
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateTemplateDraftInput,
} from "./training-advanced.validation";

const asJson = (value: unknown) => JSON.stringify(value ?? {});

function assertManager(context: TrainingContext) {
  if (!context.isOwner && !context.permissions.includes("training.create"))
    throw new ForbiddenError(
      "Only an authorized training manager can manage advanced learning settings",
    );
}

async function audit(
  client: PoolClient,
  context: TrainingContext,
  event: string,
  detail: Record<string, unknown>,
  courseId: string | null = null,
  assignmentId: string | null = null,
) {
  await client.query(
    `INSERT INTO training_audit_events (organization_id,course_id,assignment_id,actor_user_id,event_type,detail)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      context.organizationId,
      courseId,
      assignmentId,
      context.userId,
      event,
      asJson(detail),
    ],
  );
}

async function courseExists(
  client: PoolClient,
  context: TrainingContext,
  courseId: string,
) {
  const course = await client.query<{ id: string }>(
    "SELECT id FROM training_courses WHERE organization_id=$1 AND id=$2",
    [context.organizationId, courseId],
  );
  if (!course.rowCount) throw new NotFoundError("Training course not found");
}

async function assertTargetInScope(
  client: PoolClient,
  context: TrainingContext,
  audience: CourseAudienceInput,
) {
  if (audience.targetType === "organization") return;
  if (audience.targetType === "employee_category") {
    if (!context.isOwner)
      throw new ForbiddenError(
        "Only the owner can target all employee categories",
      );
    return;
  }
  const targetId = audience.targetId;
  if (!targetId) throw new NotFoundError("Audience target not found");
  const source: Record<string, string> = {
    province:
      "SELECT id, id AS province_id FROM provinces WHERE organization_id=$1 AND id=$2",
    site: "SELECT id, province_id FROM sites WHERE organization_id=$1 AND id=$2",
    department:
      "SELECT d.id,s.province_id FROM departments d LEFT JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id WHERE d.organization_id=$1 AND d.id=$2",
    employee:
      "SELECT id,province_id FROM employees WHERE organization_id=$1 AND id=$2",
    role: "SELECT id,NULL::uuid AS province_id FROM roles WHERE organization_id=$1 AND id=$2",
  };
  const query = source[audience.targetType];
  if (!query) throw new NotFoundError("Audience target not found");
  const result = await client.query<{ province_id: string | null }>(query, [
    context.organizationId,
    targetId,
  ]);
  if (!result.rowCount) throw new NotFoundError("Audience target not found");
  if (context.isOwner) return;
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId)
    throw new ForbiddenError(
      "Only the owner can target organization-wide audiences",
    );
  const allowed = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3",
    [context.organizationId, context.memberId, provinceId],
  );
  if (!allowed.rowCount) throw new NotFoundError("Audience target not found");
}

const templates = [
  [
    "onboarding",
    "Accueil et intégration",
    "induction",
    ["Bienvenue", "Mission, valeurs et contacts"],
  ],
  [
    "internal_rules",
    "Règlement intérieur",
    "compliance",
    ["Horaires et présence", "Responsabilités et discipline"],
  ],
  [
    "health_safety",
    "Santé et sécurité",
    "safety",
    ["Consignes générales", "Signalement d’un incident"],
  ],
  [
    "hygiene_biosecurity",
    "Hygiène et biosécurité",
    "biosecurity",
    ["Hygiène quotidienne", "Contrôles de biosécurité"],
  ],
  [
    "animal_welfare",
    "Manipulation et bien-être des animaux",
    "technical",
    ["Principes de bien-être", "Manipulation sûre"],
  ],
  [
    "machine_safety",
    "Sécurité des machines",
    "safety",
    ["Avant utilisation", "Arrêt et signalement"],
  ],
  [
    "first_aid",
    "Premiers secours",
    "safety",
    ["Réagir à une urgence", "Alerter et documenter"],
  ],
  [
    "incident_reporting",
    "Signalement des incidents",
    "compliance",
    ["Identifier un incident", "Faire un signalement utile"],
  ],
  [
    "poultry",
    "Formation avicole",
    "technical",
    ["Fondations avicoles", "Biosécurité avicole"],
  ],
  [
    "pigs",
    "Formation porcine",
    "technical",
    ["Fondations porcines", "Santé et élevage"],
  ],
  [
    "agriculture",
    "Formation agricole",
    "technical",
    ["Fondations agricoles", "Activités de terrain"],
  ],
] as const;

type Template = (typeof templates)[number];
function templateById(templateId: string): Template {
  const template = templates.find(([id]) => id === templateId);
  if (!template) throw new NotFoundError("Training template not found");
  return template;
}

export function listCourseTemplates() {
  return templates.map(([id, name, category, lessons]) => ({
    id,
    name,
    category,
    lessonCount: lessons.length,
  }));
}

export async function createCourseDraftFromTemplate(
  context: TrainingContext,
  input: CreateTemplateDraftInput,
) {
  assertManager(context);
  const [, name, category, lessons] = templateById(input.templateId);
  const created = await lms.createProfessionalCourse(context, {
    code: input.code,
    name,
    summary: `Brouillon issu du modèle ${name}`,
    description: null,
    category,
    learningObjectives: lessons.map((lesson) => `Maîtriser : ${lesson}`),
    estimatedDurationMinutes: lessons.length * 15,
    difficulty: "foundation",
    languages: ["fr"],
    tags: ["template", input.templateId],
    isMandatory: false,
    validityMonths: null,
    completionMode: input.completionMode,
    renewalMonths: null,
    renewalRequired: false,
    autoAssignNewEmployees: false,
    defaultDueDays: null,
  });
  const module = await lms.addModule(context, created.courseId, {
    versionId: created.versionId,
    code: `${input.templateId}_module`,
    title: name,
    introduction: "Adaptez ce brouillon avant publication.",
    summary: null,
    sortOrder: 1,
    isRequired: true,
  });
  for (const [index, lessonTitle] of lessons.entries()) {
    const lesson = await lms.addLesson(context, module.id, {
      versionId: created.versionId,
      code: `${input.templateId}_${index + 1}`,
      title: lessonTitle,
      summary: null,
      estimatedDurationMinutes: 15,
      sortOrder: index + 1,
      isRequired: true,
      requireSequential: index > 0,
      completionMode: "learner_confirmation",
    });
    await lms.addBlock(context, lesson.id, {
      blockType: "text",
      title: lessonTitle,
      content: {
        body: "Remplacez ce texte par le contenu approuvé de votre entreprise.",
      },
      documentId: null,
      externalUrl: null,
      captions: null,
      transcript: null,
      minimumWatchedPercent: 90,
      allowDownload: false,
      sortOrder: 1,
      isRequired: true,
    });
  }
  return created;
}

export async function listQuestionBanks(context: TrainingContext) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `SELECT b.id,b.name,b.description,b.category,b.is_active,b.created_at,b.updated_at,
              COUNT(q.id)::int AS question_count
         FROM training_question_banks b
         LEFT JOIN training_questions q ON q.organization_id=b.organization_id AND q.question_bank_id=b.id
        WHERE b.organization_id=$1
        GROUP BY b.id ORDER BY b.name`,
      [context.organizationId],
    );
    return result.rows;
  });
}

export async function createQuestionBank(
  context: TrainingContext,
  input: CreateQuestionBankInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `INSERT INTO training_question_banks (organization_id,name,description,category,created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,name,description,category,is_active,created_at`,
      [
        context.organizationId,
        input.name,
        input.description ?? null,
        input.category ?? null,
        context.userId,
      ],
    );
    await audit(client, context, "question_bank_created", {
      bankId: result.rows[0]?.id,
    });
    return result.rows[0];
  });
}

export async function listQuestions(context: TrainingContext, bankId: string) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `SELECT id,question_type,prompt,options,correct_answer,explanation,source_reference,points,requires_manual_grading,is_active,created_at
         FROM training_questions
        WHERE organization_id=$1 AND question_bank_id=$2 ORDER BY created_at DESC`,
      [context.organizationId, bankId],
    );
    return result.rows;
  });
}

export async function createQuestion(
  context: TrainingContext,
  bankId: string,
  input: CreateQuestionInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const bank = await client.query(
      "SELECT 1 FROM training_question_banks WHERE organization_id=$1 AND id=$2",
      [context.organizationId, bankId],
    );
    if (!bank.rowCount) throw new NotFoundError("Question bank not found");
    const result = await client.query(
      `INSERT INTO training_questions (organization_id,question_bank_id,question_type,prompt,options,correct_answer,explanation,source_reference,points,requires_manual_grading,created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id,question_type,prompt,options,explanation,source_reference,points,requires_manual_grading,is_active`,
      [
        context.organizationId,
        bankId,
        input.questionType,
        input.prompt,
        asJson(input.options),
        asJson(input.correctAnswer),
        input.explanation ?? null,
        input.sourceReference ?? null,
        input.points,
        input.requiresManualGrading,
        context.userId,
      ],
    );
    await audit(client, context, "question_created", {
      bankId,
      questionId: result.rows[0]?.id,
    });
    return result.rows[0];
  });
}

export async function replaceCourseAudiences(
  context: TrainingContext,
  courseId: string,
  audiences: CourseAudienceInput[],
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await courseExists(client, context, courseId);
    for (const audience of audiences)
      await assertTargetInScope(client, context, audience);
    await client.query(
      "DELETE FROM training_course_audiences WHERE organization_id=$1 AND course_id=$2",
      [context.organizationId, courseId],
    );
    for (const audience of audiences) {
      await client.query(
        `INSERT INTO training_course_audiences (organization_id,course_id,target_type,target_id,target_value,created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          context.organizationId,
          courseId,
          audience.targetType,
          audience.targetId ?? null,
          audience.targetValue ?? null,
          context.userId,
        ],
      );
    }
    await audit(
      client,
      context,
      "course_audience_updated",
      { count: audiences.length },
      courseId,
    );
    return listCourseAudiencesInClient(
      client,
      context.organizationId,
      courseId,
    );
  });
}

async function listCourseAudiencesInClient(
  client: PoolClient,
  organizationId: string,
  courseId: string,
) {
  const result = await client.query(
    `SELECT id,target_type,target_id,target_value,created_at
       FROM training_course_audiences
      WHERE organization_id=$1 AND course_id=$2
      ORDER BY target_type,created_at`,
    [organizationId, courseId],
  );
  return result.rows;
}

export async function listCourseAudiences(
  context: TrainingContext,
  courseId: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await courseExists(client, context, courseId);
    return listCourseAudiencesInClient(
      client,
      context.organizationId,
      courseId,
    );
  });
}

export async function addCoursePrerequisite(
  context: TrainingContext,
  courseId: string,
  prerequisiteCourseId: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await courseExists(client, context, courseId);
    await courseExists(client, context, prerequisiteCourseId);
    try {
      const result = await client.query(
        `INSERT INTO training_course_prerequisites (organization_id,course_id,prerequisite_course_id)
         VALUES ($1,$2,$3) RETURNING id,prerequisite_course_id`,
        [context.organizationId, courseId, prerequisiteCourseId],
      );
      await audit(
        client,
        context,
        "course_prerequisite_added",
        { prerequisiteCourseId },
        courseId,
      );
      return result.rows[0];
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictError("This prerequisite already exists");
      throw error;
    }
  });
}

export async function listCoursePrerequisites(
  context: TrainingContext,
  courseId: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await courseExists(client, context, courseId);
    const result = await client.query(
      `SELECT p.id,c.id AS course_id,c.code,c.name,c.lifecycle_status
         FROM training_course_prerequisites p
         JOIN training_courses c ON c.organization_id=p.organization_id AND c.id=p.prerequisite_course_id
        WHERE p.organization_id=$1 AND p.course_id=$2 ORDER BY c.name`,
      [context.organizationId, courseId],
    );
    return result.rows;
  });
}

export async function trainingManagerReport(context: TrainingContext) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const overview = await client.query(
      `SELECT status,COUNT(*)::int AS count FROM training_assignments
        WHERE organization_id=$1 GROUP BY status`,
      [context.organizationId],
    );
    const courses = await client.query(
      `SELECT c.id,c.code,c.name,
              COUNT(a.id)::int AS assigned,
              COUNT(a.id) FILTER (WHERE a.status='completed')::int AS completed,
              COUNT(a.id) FILTER (WHERE a.status IN ('overdue','expired','failed'))::int AS needs_attention
         FROM training_courses c LEFT JOIN training_assignments a ON a.organization_id=c.organization_id AND a.course_id=c.id
        WHERE c.organization_id=$1 GROUP BY c.id ORDER BY c.name`,
      [context.organizationId],
    );
    const locations = await client.query(
      `SELECT COALESCE(p.name,'Sans province') AS province,
              COUNT(a.id)::int AS assigned,
              COUNT(a.id) FILTER (WHERE a.status='completed')::int AS completed
         FROM training_assignments a
         LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=a.province_id
        WHERE a.organization_id=$1 GROUP BY p.name ORDER BY assigned DESC`,
      [context.organizationId],
    );
    const quiz = await client.query<{ average_score: string | null }>(
      `SELECT AVG(score)::text AS average_score FROM training_quiz_attempts
        WHERE organization_id=$1 AND status='graded'`,
      [context.organizationId],
    );
    const expiring = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM training_certificates
        WHERE organization_id=$1 AND revoked_at IS NULL AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`,
      [context.organizationId],
    );
    return {
      byStatus: overview.rows,
      byCourse: courses.rows,
      byProvince: locations.rows,
      averageQuizScore:
        quiz.rows[0]?.average_score === null
          ? null
          : Number(quiz.rows[0]?.average_score),
      expiringCertificates: Number(expiring.rows[0]?.count ?? 0),
    };
  });
}

export async function revokeCertificate(
  context: TrainingContext,
  certificateId: string,
  reason: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const certificate = await client.query<{
      id: string;
      assignment_id: string;
      revoked_at: Date | null;
    }>(
      "SELECT id,assignment_id,revoked_at FROM training_certificates WHERE organization_id=$1 AND id=$2",
      [context.organizationId, certificateId],
    );
    const item = certificate.rows[0];
    if (!item) throw new NotFoundError("Certificate not found");
    if (item.revoked_at)
      throw new ConflictError("Certificate is already revoked");
    await client.query(
      `UPDATE training_certificates SET revoked_at=now(),revoked_by=$3,revoke_reason=$4
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, certificateId, context.userId, reason],
    );
    await audit(
      client,
      context,
      "certificate_revoked",
      { certificateId, reason },
      null,
      item.assignment_id,
    );
    return { id: certificateId, revoked: true };
  });
}
