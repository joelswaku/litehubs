import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../config/database";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { readPrivateDocument } from "../../services/file-storage.service";
import {
  createNotificationInTransaction,
  notifyOrganizationOwnersInTransaction,
} from "../notifications/notifications.service";
import type { TrainingContext } from "./training.service";
import type {
  CreateBlockInput,
  CreateLessonInput,
  CreateModuleInput,
  CreateProfessionalCourseInput,
  UpdateBlockInput,
  LearnerBlockProgressInput,
  ApplyAiOutlineInput,
} from "./lms.validation";

const now = () => new Date();
const asNumber = (value: unknown) =>
  typeof value === "number" ? value : Number(value ?? 0);
const json = (value: unknown) => JSON.stringify(value ?? {});
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function assertManager(context: TrainingContext) {
  if (!context.isOwner && !context.permissions.includes("training.create"))
    throw new ForbiddenError(
      "Only an authorized training manager can manage professional courses",
    );
}
async function courseFor(
  client: PoolClient,
  context: TrainingContext,
  courseId: string,
) {
  const result = await client.query<{
    id: string;
    current_version_id: string | null;
    lifecycle_status: string;
    completion_mode: string;
    validity_months: number | null;
    code: string;
    name: string;
  }>(
    "SELECT id,current_version_id,lifecycle_status,completion_mode,validity_months,code,name FROM training_courses WHERE organization_id=$1 AND id=$2",
    [context.organizationId, courseId],
  );
  const course = result.rows[0];
  if (!course) throw new NotFoundError("Training course not found");
  return course;
}

/**
 * Legacy catalogue courses could be created before the professional builder
 * existed. Initialise one draft outline on first builder access, preserving all
 * existing assignments, records and certificates.
 */
async function ensureBuilderVersion(
  client: PoolClient,
  context: TrainingContext,
  course: Awaited<ReturnType<typeof courseFor>>,
) {
  if (course.current_version_id) return course.current_version_id;

  // Lock the course row so two concurrent builder opens cannot create two
  // version-one drafts. If a prior migration created a version but did not set
  // the pointer, repair that pointer instead of duplicating it.
  const locked = await client.query<{ current_version_id: string | null }>(
    "SELECT current_version_id FROM training_courses WHERE organization_id=$1 AND id=$2 FOR UPDATE",
    [context.organizationId, course.id],
  );
  if (locked.rows[0]?.current_version_id)
    return locked.rows[0].current_version_id;

  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM training_course_versions
      WHERE organization_id=$1 AND course_id=$2
      ORDER BY version_number DESC
      LIMIT 1`,
    [context.organizationId, course.id],
  );
  const versionId = existing.rows[0]?.id ?? (
    await client.query<{ id: string }>(
      `INSERT INTO training_course_versions
        (organization_id,course_id,version_number,status,title_snapshot,content_snapshot,created_by)
       VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5)
       RETURNING id`,
      [
        context.organizationId,
        course.id,
        course.name,
        json({ legacy: true, initializedForProfessionalBuilder: true }),
        context.userId,
      ],
    )
  ).rows?.[0]?.id ?? existing.rows[0]?.id;

  if (!versionId) throw new NotFoundError("Course version not found");
  await client.query(
    "UPDATE training_courses SET current_version_id=$3 WHERE organization_id=$1 AND id=$2",
    [context.organizationId, course.id, versionId],
  );
  await audit(
    client,
    context,
    course.id,
    versionId,
    null,
    "legacy_course_builder_initialized",
    { repairedPointer: Boolean(existing.rows[0]) },
  );
  return versionId;
}
async function draftVersionFor(
  client: PoolClient,
  context: TrainingContext,
  courseId: string,
  versionId: string,
) {
  const result = await client.query<{ id: string; status: string }>(
    "SELECT id,status FROM training_course_versions WHERE organization_id=$1 AND course_id=$2 AND id=$3",
    [context.organizationId, courseId, versionId],
  );
  const version = result.rows[0];
  if (!version) throw new NotFoundError("Course version not found");
  if (version.status !== "draft")
    throw new ConflictError(
      "Create a draft revision before editing a published course",
      { field: "versionId" },
    );
  return version;
}
async function assertDocument(
  client: PoolClient,
  context: TrainingContext,
  documentId: string | null | undefined,
) {
  if (!documentId) return;
  const result = await client.query<{ id: string; is_confidential: boolean }>(
    "SELECT id,is_confidential FROM documents WHERE organization_id=$1 AND id=$2",
    [context.organizationId, documentId],
  );
  const document = result.rows[0];
  if (!document)
    throw new BadRequestError("Choose a document from this company", {
      field: "documentId",
    });
  if (document.is_confidential)
    throw new BadRequestError(
      "A confidential company document cannot be used as learner content",
      {
        field: "documentId",
      },
    );
}
async function assertInstructor(
  client: PoolClient,
  context: TrainingContext,
  userId: string | null | undefined,
) {
  if (!userId) return;
  const member = await client.query(
    "SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2",
    [context.organizationId, userId],
  );
  if (!member.rowCount)
    throw new BadRequestError("Choose an instructor in this company", {
      field: "instructorUserId",
    });
}
async function ownAssignment(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
) {
  const result = await client.query<{
    id: string;
    employee_id: string;
    course_id: string;
    course_version_id: string | null;
    status: string;
    due_on: string | null;
    progress_percent: string;
    completion_mode: string;
    validity_months: number | null;
    course_name: string;
    course_code: string;
    course_category: string;
    course_summary: string | null;
  }>(
    `SELECT a.id,a.employee_id,a.course_id,a.course_version_id,a.status,a.due_on::text,a.progress_percent::text,c.completion_mode,c.validity_months,c.name AS course_name,c.code AS course_code,c.category AS course_category,c.summary AS course_summary
       FROM training_assignments a
       JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
       JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
      WHERE a.organization_id=$1 AND a.id=$2 AND e.member_id=$3`,
    [context.organizationId, assignmentId, context.memberId],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new NotFoundError("Training assignment not found");
  if (!assignment.course_version_id)
    throw new ConflictError(
      "This legacy training has no professional course version yet",
    );
  return assignment;
}

export async function createProfessionalCourse(
  context: TrainingContext,
  input: CreateProfessionalCourseInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await assertInstructor(client, context, input.instructorUserId);
    const course = await client.query<{ id: string }>(
      `INSERT INTO training_courses (organization_id,code,name,summary,description,category,learning_objectives,estimated_duration_minutes,difficulty,languages,instructor_user_id,tags,is_mandatory,validity_months,is_active,lifecycle_status,completion_mode,renewal_months,renewal_required,auto_assign_new_employees,default_due_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14,false,'draft',$15,$16,$17,$18,$19) RETURNING id`,
      [
        context.organizationId,
        input.code,
        input.name,
        input.summary ?? null,
        input.description ?? null,
        input.category,
        json(input.learningObjectives),
        input.estimatedDurationMinutes ?? null,
        input.difficulty,
        input.languages,
        input.instructorUserId ?? null,
        json(input.tags),
        input.isMandatory,
        input.validityMonths ?? null,
        input.completionMode,
        input.renewalMonths ?? null,
        input.renewalRequired,
        input.autoAssignNewEmployees,
        input.defaultDueDays ?? null,
      ],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO training_course_versions (organization_id,course_id,version_number,status,title_snapshot,content_snapshot,created_by)
       VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5) RETURNING id`,
      [
        context.organizationId,
        course.rows[0]!.id,
        input.name,
        json({
          summary: input.summary,
          objectives: input.learningObjectives,
          languages: input.languages,
        }),
        context.userId,
      ],
    );
    await client.query(
      "UPDATE training_courses SET current_version_id=$3 WHERE organization_id=$1 AND id=$2",
      [context.organizationId, course.rows[0]!.id, version.rows[0]!.id],
    );
    await audit(
      client,
      context,
      course.rows[0]!.id,
      version.rows[0]!.id,
      null,
      "course_created",
      { draft: true },
    );
    return { courseId: course.rows[0]!.id, versionId: version.rows[0]!.id };
  });
}

export async function courseBuilder(
  context: TrainingContext,
  courseId: string,
  requestedVersionId?: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const course = await courseFor(client, context, courseId);
    // A builder link can contain an obsolete reference after a legacy course
    // is initialised or a draft is recreated. Only use a requested version when
    // it is a valid version of this exact course; otherwise resolve the safe
    // current version without touching another course.
    const requested = isUuid(requestedVersionId)
      ? await client.query<{ id: string }>(
          "SELECT id FROM training_course_versions WHERE organization_id=$1 AND course_id=$2 AND id=$3",
          [context.organizationId, courseId, requestedVersionId],
        )
      : { rows: [] as Array<{ id: string }> };
    const versionId =
      requested.rows[0]?.id ??
      (await ensureBuilderVersion(client, context, course));
    if (!versionId) throw new NotFoundError("Course version not found");
    const versions = await client.query(
      `SELECT id,version_number,status,change_summary,requires_retake,published_at,created_at FROM training_course_versions WHERE organization_id=$1 AND course_id=$2 ORDER BY version_number DESC`,
      [context.organizationId, courseId],
    );
    const modules = await client.query(
      `SELECT id,code,title,introduction,summary,sort_order,is_required FROM training_modules WHERE organization_id=$1 AND course_id=$2 AND version_id=$3 ORDER BY sort_order,created_at`,
      [context.organizationId, courseId, versionId],
    );
    const lessons = await client.query(
      `SELECT id,module_id,code,title,summary,estimated_duration_minutes,sort_order,is_required,require_sequential,completion_mode FROM training_lessons WHERE organization_id=$1 AND course_id=$2 AND version_id=$3 ORDER BY sort_order,created_at`,
      [context.organizationId, courseId, versionId],
    );
    const lessonIds = lessons.rows.map((row: any) => row.id);
    const blocks = lessonIds.length
      ? await client.query(
          `SELECT id,lesson_id,block_type,title,content,document_id,external_url,captions,transcript,minimum_watched_percent,allow_download,sort_order,is_required FROM training_content_blocks WHERE organization_id=$1 AND lesson_id=ANY($2::uuid[]) ORDER BY sort_order,created_at`,
          [context.organizationId, lessonIds],
        )
      : { rows: [] as any[] };
    return {
      course,
      activeVersionId: versionId,
      versions: versions.rows,
      modules: modules.rows.map((module: any) => ({
        ...module,
        lessons: lessons.rows
          .filter((lesson: any) => lesson.module_id === module.id)
          .map((lesson: any) => ({
            ...lesson,
            blocks: blocks.rows.filter(
              (block: any) => block.lesson_id === lesson.id,
            ),
          })),
      })),
    };
  });
}

export async function addModule(
  context: TrainingContext,
  courseId: string,
  input: CreateModuleInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    await courseFor(client, context, courseId);
    await draftVersionFor(client, context, courseId, input.versionId);
    const row = await client.query(
      `INSERT INTO training_modules (organization_id,course_id,version_id,code,title,introduction,summary,sort_order,is_required,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        context.organizationId,
        courseId,
        input.versionId,
        input.code,
        input.title,
        input.introduction ?? null,
        input.summary ?? null,
        input.sortOrder,
        input.isRequired,
        context.userId,
      ],
    );
    await audit(
      client,
      context,
      courseId,
      input.versionId,
      null,
      "module_added",
      { moduleId: row.rows[0]!.id },
    );
    return row.rows[0];
  });
}
export async function addLesson(
  context: TrainingContext,
  moduleId: string,
  input: CreateLessonInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const module = await client.query<{
      course_id: string;
      version_id: string;
    }>(
      "SELECT course_id,version_id FROM training_modules WHERE organization_id=$1 AND id=$2",
      [context.organizationId, moduleId],
    );
    const parent = module.rows[0];
    if (!parent) throw new NotFoundError("Training module not found");
    if (parent.version_id !== input.versionId)
      throw new BadRequestError("Lesson version must match its module", {
        field: "versionId",
      });
    await draftVersionFor(client, context, parent.course_id, input.versionId);
    const row = await client.query(
      `INSERT INTO training_lessons (organization_id,course_id,version_id,module_id,code,title,summary,estimated_duration_minutes,sort_order,is_required,require_sequential,completion_mode,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        context.organizationId,
        parent.course_id,
        input.versionId,
        moduleId,
        input.code,
        input.title,
        input.summary ?? null,
        input.estimatedDurationMinutes ?? null,
        input.sortOrder,
        input.isRequired,
        input.requireSequential,
        input.completionMode,
        context.userId,
      ],
    );
    await audit(
      client,
      context,
      parent.course_id,
      input.versionId,
      null,
      "lesson_added",
      { lessonId: row.rows[0]!.id },
    );
    return row.rows[0];
  });
}
const firstText = (...values: unknown[]) => {
  for (const value of values)
    if (typeof value === "string" && value.trim()) return value.trim();
  return null;
};
const positiveInt = (...values: unknown[]) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
};
const objects = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
const textList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      ).map((item) => item.trim())
    : [];
const importedCode = (prefix: string, position: number, title: string) => {
  const suffix = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
  return `${prefix}_${position}_${suffix || "item"}`.slice(0, 62);
};

/**
 * Imports an AI outline only into an explicitly selected draft version. The
 * original AI result is never published and existing draft content is only
 * cleared when the administrator opts in. One result cannot be imported twice.
 */
export async function importAiOutline(
  context: TrainingContext,
  courseId: string,
  input: ApplyAiOutlineInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const course = await courseFor(client, context, courseId);
    await draftVersionFor(client, context, courseId, input.versionId);
    const fingerprint = createHash("sha256")
      .update(`${input.replaceExisting}\n${JSON.stringify(input.draft)}`)
      .digest("hex");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `training-ai-outline:${context.organizationId}:${courseId}:${input.versionId}:${fingerprint}`,
    ]);
    const prior = await client.query<{ id: string }>(
      `SELECT id FROM training_audit_events
        WHERE organization_id=$1 AND course_id=$2 AND version_id=$3
          AND event_type='ai_outline_imported' AND detail->>'fingerprint'=$4
        LIMIT 1`,
      [context.organizationId, courseId, input.versionId, fingerprint],
    );
    if (prior.rowCount)
      return { imported: false, duplicate: true, modules: 0, lessons: 0, acknowledgments: 0 };

    if (input.replaceExisting) {
      await client.query(
        `DELETE FROM training_content_blocks
          WHERE organization_id=$1 AND lesson_id IN (
            SELECT id FROM training_lessons
             WHERE organization_id=$1 AND course_id=$2 AND version_id=$3
          )`,
        [context.organizationId, courseId, input.versionId],
      );
      await client.query(
        "DELETE FROM training_lessons WHERE organization_id=$1 AND course_id=$2 AND version_id=$3",
        [context.organizationId, courseId, input.versionId],
      );
      await client.query(
        "DELETE FROM training_modules WHERE organization_id=$1 AND course_id=$2 AND version_id=$3",
        [context.organizationId, courseId, input.versionId],
      );
    }

    const draft = input.draft as unknown as Record<string, unknown>;
    if (input.applyCourseDetails) {
      const description = firstText(draft.description);
      const summary = firstText(draft.summary) ?? description?.slice(0, 600) ?? null;
      const objectives = textList(draft.learningObjectives ?? draft.objectifs_pedagogiques);
      const duration = positiveInt(
        draft.estimatedDurationMinutes,
        draft.estimated_duration_minutes,
        draft.duree_totale_estimee_minutes,
      );
      await client.query(
        `UPDATE training_courses
            SET summary=COALESCE($3,summary),
                description=COALESCE($4,description),
                learning_objectives=CASE WHEN $5::jsonb IS NULL THEN learning_objectives ELSE $5::jsonb END,
                estimated_duration_minutes=COALESCE($6,estimated_duration_minutes)
          WHERE organization_id=$1 AND id=$2`,
        [
          context.organizationId,
          courseId,
          summary,
          description,
          objectives.length ? json(objectives) : null,
          duration,
        ],
      );
    }

    const orderResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM training_modules WHERE organization_id=$1 AND course_id=$2 AND version_id=$3",
      [context.organizationId, courseId, input.versionId],
    );
    const moduleOffset = Number(orderResult.rows[0]?.count ?? 0);
    let moduleCount = 0;
    let lessonCount = 0;
    let lastLessonId: string | null = null;
    for (const [moduleIndex, rawModule] of objects(draft.modules).entries()) {
      const moduleTitle = firstText(rawModule.title, rawModule.titre)!;
      const objectives = textList(rawModule.learningObjectives ?? rawModule.objectifs_pedagogiques);
      const moduleDescription = firstText(
        rawModule.introduction,
        rawModule.description,
        rawModule.summary,
      );
      const module = await client.query<{ id: string }>(
        `INSERT INTO training_modules (organization_id,course_id,version_id,code,title,introduction,summary,sort_order,is_required,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING id`,
        [
          context.organizationId,
          courseId,
          input.versionId,
          importedCode("ai_module", moduleOffset + moduleIndex + 1, moduleTitle),
          moduleTitle,
          objectives.length
            ? `Objectifs pédagogiques :\n${objectives.map((item) => `• ${item}`).join("\n")}`
            : moduleDescription,
          moduleDescription,
          moduleOffset + moduleIndex + 1,
          context.userId,
        ],
      );
      moduleCount += 1;
      const rawLessons = objects(rawModule.lessons ?? rawModule.lecons);
      for (const [lessonIndex, rawLesson] of rawLessons.entries()) {
        const lessonTitle = firstText(rawLesson.title, rawLesson.titre)!;
        const lesson = await client.query<{ id: string }>(
          `INSERT INTO training_lessons (organization_id,course_id,version_id,module_id,code,title,summary,estimated_duration_minutes,sort_order,is_required,require_sequential,completion_mode,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,'learner_confirmation',$10) RETURNING id`,
          [
            context.organizationId,
            courseId,
            input.versionId,
            module.rows[0]!.id,
            importedCode(`ai_lesson_m${moduleIndex + 1}`, lessonIndex + 1, lessonTitle),
            lessonTitle,
            firstText(rawLesson.summary, rawLesson.description, rawLesson.contenu),
            positiveInt(
              rawLesson.estimatedDurationMinutes,
              rawLesson.estimated_duration_minutes,
              rawLesson.duree_estimee_minutes,
            ),
            lessonIndex + 1,
            context.userId,
          ],
        );
        lastLessonId = lesson.rows[0]!.id;
        lessonCount += 1;
      }
    }

    const acknowledgments = objects(
      draft.acknowledgments ?? draft.attestations_obligatoires,
    );
    let acknowledgmentCount = 0;
    if (lastLessonId) {
      for (const [index, acknowledgment] of acknowledgments.entries()) {
        const body = firstText(acknowledgment.text, acknowledgment.texte);
        if (!body) continue;
        await client.query(
          `INSERT INTO training_content_blocks (organization_id,lesson_id,block_type,title,content,minimum_watched_percent,allow_download,sort_order,is_required,created_by)
           VALUES ($1,$2,'acknowledgment',$3,$4::jsonb,90,false,$5,true,$6)`,
          [
            context.organizationId,
            lastLessonId,
            `Attestation ${index + 1}`,
            json({ body }),
            index + 1,
            context.userId,
          ],
        );
        acknowledgmentCount += 1;
      }
    }
    await audit(client, context, courseId, input.versionId, null, "ai_outline_imported", {
      fingerprint,
      replaceExisting: input.replaceExisting,
      modules: moduleCount,
      lessons: lessonCount,
      acknowledgments: acknowledgmentCount,
      aiReviewRequired: true,
      courseName: course.name,
    });
    return {
      imported: true,
      duplicate: false,
      modules: moduleCount,
      lessons: lessonCount,
      acknowledgments: acknowledgmentCount,
    };
  });
}
export async function addBlock(
  context: TrainingContext,
  lessonId: string,
  input: CreateBlockInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const lesson = await client.query<{
      course_id: string;
      version_id: string;
    }>(
      "SELECT course_id,version_id FROM training_lessons WHERE organization_id=$1 AND id=$2",
      [context.organizationId, lessonId],
    );
    const parent = lesson.rows[0];
    if (!parent) throw new NotFoundError("Training lesson not found");
    await draftVersionFor(client, context, parent.course_id, parent.version_id);
    await assertDocument(client, context, input.documentId);
    let blockContent = input.content;
    if (
      input.blockType === "quiz" &&
      typeof input.content.questionBankId === "string"
    ) {
      const bank = await client.query<{
        id: string;
        prompt: string;
        question_type: string;
        options: unknown;
        correct_answer: unknown;
        explanation: string | null;
        source_reference: string | null;
        points: string;
        requires_manual_grading: boolean;
      }>(
        `SELECT q.id,q.prompt,q.question_type,q.options,q.correct_answer,q.explanation,q.source_reference,q.points::text,q.requires_manual_grading
           FROM training_questions q
           JOIN training_question_banks b ON b.organization_id=q.organization_id AND b.id=q.question_bank_id
          WHERE q.organization_id=$1 AND q.question_bank_id=$2 AND q.is_active AND b.is_active
          ORDER BY q.created_at,q.id`,
        [context.organizationId, input.content.questionBankId],
      );
      if (!bank.rowCount)
        throw new ConflictError("The selected question bank has no active questions", {
          field: "questionBankId",
        });
      const requested = Number(input.content.drawCount ?? bank.rowCount);
      const take = Number.isInteger(requested)
        ? Math.max(1, Math.min(requested, bank.rowCount))
        : bank.rowCount;
      // Snapshot questions into this draft version. Later bank edits cannot alter
      // a learner’s assessment or expose answer keys to the browser.
      blockContent = {
        ...input.content,
        drawCount: take,
        questions: bank.rows.slice(0, take).map((question) => ({
          id: question.id,
          type: question.question_type,
          question: question.prompt,
          options: question.options,
          correctAnswer: question.correct_answer,
          explanation: question.explanation,
          sourceReference: question.source_reference,
          points: Number(question.points),
          requiresManualGrading: question.requires_manual_grading,
        })),
      };
    }
    const row = await client.query(
      `INSERT INTO training_content_blocks (organization_id,lesson_id,block_type,title,content,document_id,external_url,captions,transcript,minimum_watched_percent,allow_download,sort_order,is_required,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        context.organizationId,
        lessonId,
        input.blockType,
        input.title ?? null,
        json(blockContent),
        input.documentId ?? null,
        input.externalUrl ?? null,
        input.captions ?? null,
        input.transcript ?? null,
        input.minimumWatchedPercent,
        input.allowDownload,
        input.sortOrder,
        input.isRequired,
        context.userId,
      ],
    );
    await audit(
      client,
      context,
      parent.course_id,
      parent.version_id,
      null,
      "content_block_added",
      { blockId: row.rows[0]!.id, type: input.blockType },
    );
    return row.rows[0];
  });
}
export async function updateBlock(
  context: TrainingContext,
  blockId: string,
  input: UpdateBlockInput,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query<{
      id: string;
      course_id: string;
      version_id: string;
      block_type: string;
      title: string | null;
      content: Record<string, unknown>;
      document_id: string | null;
      external_url: string | null;
      captions: string | null;
      transcript: string | null;
      minimum_watched_percent: string;
      allow_download: boolean;
      sort_order: number;
      is_required: boolean;
    }>(
      `SELECT b.*,l.course_id,l.version_id
         FROM training_content_blocks b
         JOIN training_lessons l ON l.organization_id=b.organization_id AND l.id=b.lesson_id
        WHERE b.organization_id=$1 AND b.id=$2`,
      [context.organizationId, blockId],
    );
    const block = result.rows[0];
    if (!block) throw new NotFoundError("Training content block not found");
    await draftVersionFor(client, context, block.course_id, block.version_id);
    if (input.documentId !== undefined)
      await assertDocument(client, context, input.documentId);

    const has = (key: keyof UpdateBlockInput) =>
      Object.prototype.hasOwnProperty.call(input, key);
    const nextType = input.blockType ?? block.block_type;
    let nextContent = has("content") ? input.content ?? {} : block.content;
    if (
      nextType === "quiz" &&
      has("content") &&
      typeof (nextContent as Record<string, unknown>).questionBankId === "string"
    ) {
      const questionBankId = String(
        (nextContent as Record<string, unknown>).questionBankId,
      );
      const bank = await client.query<{
        id: string;
        prompt: string;
        question_type: string;
        options: unknown;
        correct_answer: unknown;
        explanation: string | null;
        source_reference: string | null;
        points: string;
        requires_manual_grading: boolean;
      }>(
        `SELECT q.id,q.prompt,q.question_type,q.options,q.correct_answer,q.explanation,q.source_reference,q.points::text,q.requires_manual_grading
           FROM training_questions q
           JOIN training_question_banks b ON b.organization_id=q.organization_id AND b.id=q.question_bank_id
          WHERE q.organization_id=$1 AND q.question_bank_id=$2 AND q.is_active AND b.is_active
          ORDER BY q.created_at,q.id`,
        [context.organizationId, questionBankId],
      );
      if (!bank.rowCount)
        throw new ConflictError("The selected question bank has no active questions", {
          field: "questionBankId",
        });
      const requested = Number(
        (nextContent as Record<string, unknown>).drawCount ?? bank.rowCount,
      );
      const take = Number.isInteger(requested)
        ? Math.max(1, Math.min(requested, bank.rowCount))
        : bank.rowCount;
      nextContent = {
        ...(nextContent as Record<string, unknown>),
        drawCount: take,
        questions: bank.rows.slice(0, take).map((question) => ({
          id: question.id,
          type: question.question_type,
          question: question.prompt,
          options: question.options,
          correctAnswer: question.correct_answer,
          explanation: question.explanation,
          sourceReference: question.source_reference,
          points: Number(question.points),
          requiresManualGrading: question.requires_manual_grading,
        })),
      };
    }

    const row = await client.query(
      `UPDATE training_content_blocks
          SET block_type=$3,title=$4,content=$5::jsonb,document_id=$6,external_url=$7,captions=$8,transcript=$9,minimum_watched_percent=$10,allow_download=$11,sort_order=$12,is_required=$13
        WHERE organization_id=$1 AND id=$2
      RETURNING *`,
      [
        context.organizationId,
        blockId,
        nextType,
        has("title") ? input.title ?? null : block.title,
        json(nextContent),
        has("documentId") ? input.documentId ?? null : block.document_id,
        has("externalUrl") ? input.externalUrl ?? null : block.external_url,
        has("captions") ? input.captions ?? null : block.captions,
        has("transcript") ? input.transcript ?? null : block.transcript,
        has("minimumWatchedPercent")
          ? input.minimumWatchedPercent
          : Number(block.minimum_watched_percent),
        has("allowDownload") ? input.allowDownload : block.allow_download,
        has("sortOrder") ? input.sortOrder : block.sort_order,
        has("isRequired") ? input.isRequired : block.is_required,
      ],
    );
    await audit(client, context, block.course_id, block.version_id, null, "content_block_updated", {
      blockId,
      type: nextType,
    });
    return row.rows[0];
  });
}

export async function deleteBlock(context: TrainingContext, blockId: string) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query<{
      course_id: string;
      version_id: string;
    }>(
      `SELECT l.course_id,l.version_id
         FROM training_content_blocks b
         JOIN training_lessons l ON l.organization_id=b.organization_id AND l.id=b.lesson_id
        WHERE b.organization_id=$1 AND b.id=$2`,
      [context.organizationId, blockId],
    );
    const block = result.rows[0];
    if (!block) throw new NotFoundError("Training content block not found");
    await draftVersionFor(client, context, block.course_id, block.version_id);
    await client.query(
      "DELETE FROM training_content_blocks WHERE organization_id=$1 AND id=$2",
      [context.organizationId, blockId],
    );
    await audit(client, context, block.course_id, block.version_id, null, "content_block_deleted", {
      blockId,
    });
  });
}

export async function publishCourse(
  context: TrainingContext,
  courseId: string,
  versionId: string,
  input: { changeSummary?: string | null; requiresRetake: boolean },
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const course = await courseFor(client, context, courseId);
    await draftVersionFor(client, context, courseId, versionId);
    const count = await client.query<{ lessons: string }>(
      "SELECT COUNT(*)::text AS lessons FROM training_lessons WHERE organization_id=$1 AND version_id=$2",
      [context.organizationId, versionId],
    );
    if (Number(count.rows[0]?.lessons ?? 0) === 0)
      throw new ConflictError("Add at least one lesson before publishing", {
        field: "lessons",
      });
    await client.query(
      "UPDATE training_course_versions SET status='archived' WHERE organization_id=$1 AND course_id=$2 AND status='published'",
      [context.organizationId, courseId],
    );
    await client.query(
      "UPDATE training_course_versions SET status='published',published_at=now(),published_by=$4,change_summary=$5,requires_retake=$6 WHERE organization_id=$1 AND course_id=$2 AND id=$3",
      [
        context.organizationId,
        courseId,
        versionId,
        context.userId,
        input.changeSummary ?? null,
        input.requiresRetake,
      ],
    );
    await client.query(
      "UPDATE training_courses SET current_version_id=$3,lifecycle_status='published',is_active=true WHERE organization_id=$1 AND id=$2",
      [context.organizationId, courseId, versionId],
    );
    await audit(
      client,
      context,
      courseId,
      versionId,
      null,
      "course_published",
      { requiresRetake: input.requiresRetake },
    );
    return { courseId, versionId, status: "published" };
  });
}

function publicBlock(block: any) {
  const content =
    typeof block.content === "object" && block.content
      ? { ...block.content }
      : {};
  if (block.block_type === "quiz" && Array.isArray((content as any).questions))
    (content as any).questions = (content as any).questions.map(
      ({
        correctAnswer,
        correctOption,
        correctAnswers,
        answer,
        answers,
        ...question
      }: any) => question,
    );
  return {
    id: block.id,
    type: block.block_type,
    title: block.title,
    content,
    documentId: block.document_id,
    externalUrl: block.external_url,
    captions: block.captions,
    transcript: block.transcript,
    minimumWatchedPercent: Number(block.minimum_watched_percent),
    allowDownload: block.allow_download,
    sortOrder: block.sort_order,
    isRequired: block.is_required,
  };
}
export async function learnerCourse(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await ownAssignment(client, context, assignmentId);
    const modules = await client.query(
      `SELECT id,title,introduction,summary,sort_order,is_required FROM training_modules WHERE organization_id=$1 AND version_id=$2 ORDER BY sort_order,created_at`,
      [context.organizationId, assignment.course_version_id],
    );
    const lessons = await client.query(
      `SELECT l.*,p.status AS progress_status,p.completed_at,p.last_opened_at,p.last_block_id,p.last_video_position_seconds FROM training_lessons l LEFT JOIN training_assignment_lesson_progress p ON p.organization_id=l.organization_id AND p.assignment_id=$3 AND p.lesson_id=l.id WHERE l.organization_id=$1 AND l.version_id=$2 ORDER BY l.sort_order,l.created_at`,
      [context.organizationId, assignment.course_version_id, assignmentId],
    );
    const ids = lessons.rows.map((row: any) => row.id);
    const blocks = ids.length
      ? await client.query(
          `SELECT b.*,p.opened_at,p.completed_at,p.acknowledged_at,p.checklist_state,p.response_text,p.watched_seconds,p.last_video_position_seconds FROM training_content_blocks b LEFT JOIN training_assignment_content_progress p ON p.organization_id=b.organization_id AND p.assignment_id=$3 AND p.block_id=b.id WHERE b.organization_id=$1 AND b.lesson_id=ANY($2::uuid[]) ORDER BY b.sort_order,b.created_at`,
          [context.organizationId, ids, assignmentId],
        )
      : { rows: [] as any[] };
    return {
      assignment: {
        id: assignment.id,
        status: assignment.status,
        dueOn: assignment.due_on,
        progressPercent: Number(assignment.progress_percent ?? 0),
        course: {
          id: assignment.course_id,
          code: assignment.course_code,
          name: assignment.course_name,
          category: assignment.course_category,
          summary: assignment.course_summary,
          validityMonths: assignment.validity_months,
          completionMode: assignment.completion_mode,
        },
      },
      modules: modules.rows.map((module: any) => ({
        ...module,
        lessons: lessons.rows
          .filter((lesson: any) => lesson.module_id === module.id)
          .map((lesson: any) => ({
            id: lesson.id,
            title: lesson.title,
            summary: lesson.summary,
            estimatedDurationMinutes: lesson.estimated_duration_minutes,
            required: lesson.is_required,
            sequential: lesson.require_sequential,
            completionMode: lesson.completion_mode,
            progress: {
              status: lesson.progress_status ?? "not_started",
              completedAt: lesson.completed_at,
              lastOpenedAt: lesson.last_opened_at,
              lastBlockId: lesson.last_block_id,
              videoPositionSeconds: lesson.last_video_position_seconds,
            },
            blocks: blocks.rows
              .filter((block: any) => block.lesson_id === lesson.id)
              .map((block: any) => ({
                ...publicBlock(block),
                progress: {
                  openedAt: block.opened_at,
                  completedAt: block.completed_at,
                  acknowledgedAt: block.acknowledged_at,
                  checklistState: block.checklist_state,
                  responseText: block.response_text,
                  watchedSeconds: block.watched_seconds,
                  videoPositionSeconds: block.last_video_position_seconds,
                },
              })),
          })),
      })),
    };
  });
}

async function audit(
  client: PoolClient,
  context: TrainingContext,
  courseId: string | null,
  versionId: string | null,
  assignmentId: string | null,
  event: string,
  detail: unknown,
) {
  await client.query(
    "INSERT INTO training_audit_events (organization_id,course_id,version_id,assignment_id,actor_user_id,event_type,detail) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      context.organizationId,
      courseId,
      versionId,
      assignmentId,
      context.userId,
      event,
      json(detail),
    ],
  );
}
function contentItems(content: unknown) {
  const data =
    content && typeof content === "object"
      ? (content as Record<string, unknown>)
      : {};
  return Array.isArray(data.items)
    ? data.items.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}
async function issueAutomaticCertificate(
  client: PoolClient,
  context: TrainingContext,
  assignment: Awaited<ReturnType<typeof ownAssignment>>,
) {
  const certificateNumber = `LMS-${new Date().getUTCFullYear()}-${assignment.id.slice(0, 8).toUpperCase()}`;
  await client.query(
    `INSERT INTO training_certificates (organization_id,assignment_id,employee_id,course_id,course_version_id,certificate_number,expires_on,approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::integer IS NULL THEN NULL ELSE CURRENT_DATE + ($7::integer * INTERVAL '1 month') END,$8)
     ON CONFLICT (organization_id,assignment_id) DO NOTHING`,
    [
      context.organizationId,
      assignment.id,
      assignment.employee_id,
      assignment.course_id,
      assignment.course_version_id,
      certificateNumber,
      assignment.validity_months,
      context.userId,
    ],
  );
}
async function recalculateProfessionalAssignment(
  client: PoolClient,
  context: TrainingContext,
  assignment: Awaited<ReturnType<typeof ownAssignment>>,
) {
  const totals = await client.query<{ total: string; complete: string }>(
    `SELECT COUNT(l.id) FILTER (WHERE l.is_required)::text AS total,
            COUNT(l.id) FILTER (WHERE l.is_required AND p.status='completed')::text AS complete
       FROM training_lessons l
       LEFT JOIN training_assignment_lesson_progress p ON p.organization_id=l.organization_id AND p.assignment_id=$3 AND p.lesson_id=l.id
      WHERE l.organization_id=$1 AND l.version_id=$2`,
    [context.organizationId, assignment.course_version_id, assignment.id],
  );
  const total = Number(totals.rows[0]?.total ?? 0);
  const complete = Number(totals.rows[0]?.complete ?? 0);
  const progress = total ? Math.round((complete / total) * 100) : 0;
  let status = "in_progress";
  if (total > 0 && complete === total)
    status =
      assignment.completion_mode === "automatic"
        ? "completed"
        : "awaiting_review";
  await client.query(
    `UPDATE training_assignments SET progress_percent=$3,status=$4,started_on=COALESCE(started_on,CURRENT_DATE),completed_on=CASE WHEN $4='completed' THEN COALESCE(completed_on,CURRENT_DATE) ELSE completed_on END,submitted_on=CASE WHEN $4='awaiting_review' THEN COALESCE(submitted_on,CURRENT_DATE) ELSE submitted_on END,last_opened_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, assignment.id, progress, status],
  );
  if (status === "completed") {
    await issueAutomaticCertificate(client, context, assignment);
    await createNotificationInTransaction(client, {
      organizationId: context.organizationId,
      recipientMemberId: context.memberId,
      recipientEmployeeId: assignment.employee_id,
      actorUserId: context.userId,
      type: "training_certificate_issued",
      category: "training",
      priority: "normal",
      title: "Training certificate issued",
      message: assignment.course_name,
      actionUrl: `/my-trainings/${assignment.id}`,
      entityType: "training_assignment",
      entityId: assignment.id,
      deduplicationKey: `training-certificate:${assignment.id}`,
    });
  }
  if (status === "awaiting_review")
    await notifyOrganizationOwnersInTransaction(client, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      type: "training_validation_required",
      category: "training",
      priority: "normal",
      title: "Training needs validation",
      message: assignment.course_name,
      actionUrl: "/training",
      entityType: "training_assignment",
      entityId: assignment.id,
      deduplicationKey: `professional-training-validation:${assignment.id}`,
    });
  return {
    progressPercent: progress,
    status,
    totalRequiredLessons: total,
    completedRequiredLessons: complete,
  };
}
export async function recordLearnerBlockProgress(
  context: TrainingContext,
  assignmentId: string,
  blockId: string,
  input: LearnerBlockProgressInput,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await ownAssignment(client, context, assignmentId);
    if (!["assigned", "in_progress", "overdue"].includes(assignment.status))
      throw new ConflictError("This training is no longer open for learning", {
        field: "status",
      });
    const result = await client.query<any>(
      `SELECT b.*,l.id AS lesson_id,l.require_sequential,l.completion_mode,l.sort_order AS lesson_order,m.sort_order AS module_order
         FROM training_content_blocks b
         JOIN training_lessons l ON l.organization_id=b.organization_id AND l.id=b.lesson_id
         JOIN training_modules m ON m.organization_id=l.organization_id AND m.id=l.module_id
        WHERE b.organization_id=$1 AND b.id=$2 AND l.version_id=$3`,
      [context.organizationId, blockId, assignment.course_version_id],
    );
    const block = result.rows[0];
    if (!block) throw new NotFoundError("Training content block not found");
    if (block.require_sequential) {
      const prior = await client.query<{ missing: string }>(
        `SELECT COUNT(l.id) FILTER (WHERE l.is_required AND COALESCE(p.status,'not_started') <> 'completed')::text AS missing
           FROM training_lessons l
           JOIN training_modules m ON m.organization_id=l.organization_id AND m.id=l.module_id
           LEFT JOIN training_assignment_lesson_progress p ON p.organization_id=l.organization_id AND p.assignment_id=$4 AND p.lesson_id=l.id
          WHERE l.organization_id=$1 AND l.version_id=$2 AND (m.sort_order < $3 OR (m.sort_order=$3 AND l.sort_order < $5))`,
        [
          context.organizationId,
          assignment.course_version_id,
          block.module_order,
          assignment.id,
          block.lesson_order,
        ],
      );
      if (Number(prior.rows[0]?.missing ?? 0) > 0)
        throw new ConflictError(
          "Complete the previous required lessons first",
          { field: "lessonId" },
        );
    }
    const previous = await client.query<any>(
      "SELECT * FROM training_assignment_content_progress WHERE organization_id=$1 AND assignment_id=$2 AND block_id=$3",
      [context.organizationId, assignment.id, blockId],
    );
    const old = previous.rows[0] ?? {};
    const content =
      block.content && typeof block.content === "object"
        ? (block.content as Record<string, unknown>)
        : {};
    let watched = Number(old.watched_seconds ?? 0),
      position = Number(old.last_video_position_seconds ?? 0);
    let completed = Boolean(old.completed_at),
      acknowledged = Boolean(old.acknowledged_at);
    let checklist = Array.isArray(old.checklist_state)
      ? old.checklist_state
      : [];
    let response = old.response_text ?? null;
    if (input.action === "heartbeat") {
      if (!["video", "audio"].includes(block.block_type))
        throw new BadRequestError(
          "Heartbeat is only valid for video or audio content",
          { field: "action" },
        );
      const nextPosition = input.videoPositionSeconds ?? position;
      const elapsed = old.last_heartbeat_at
        ? Math.max(
            0,
            Math.floor(
              (now().getTime() - new Date(old.last_heartbeat_at).getTime()) /
                1000,
            ),
          )
        : 15;
      watched += Math.min(Math.max(0, nextPosition - position), elapsed + 15);
      position = nextPosition;
      const duration = asNumber(content.durationSeconds);
      if (
        duration > 0 &&
        (watched / duration) * 100 >= Number(block.minimum_watched_percent)
      )
        completed = true;
    } else if (input.action === "acknowledge") {
      acknowledged = true;
      if (block.block_type === "acknowledgment") completed = true;
    } else if (input.action === "checklist") {
      checklist = input.checklistItemIds ?? [];
      const required = contentItems(content)
        .filter((item) => item.required !== false)
        .map((item) => String(item.id ?? ""));
      completed =
        required.length > 0 &&
        required.every((item) => checklist.includes(item));
    } else if (input.action === "response") {
      response = input.responseText ?? null;
      completed = Boolean(response);
    } else if (input.action === "confirm") {
      if (["quiz", "supervisor_verification"].includes(block.block_type))
        throw new ConflictError(
          "This content needs its dedicated completion workflow",
          { field: "action" },
        );
      completed = true;
    }
    await client.query(
      `INSERT INTO training_assignment_content_progress (organization_id,assignment_id,lesson_id,block_id,opened_at,completed_at,acknowledged_at,checklist_state,response_text,watched_seconds,last_video_position_seconds,last_heartbeat_at)
       VALUES ($1,$2,$3,$4,now(),CASE WHEN $5 THEN now() END,CASE WHEN $6 THEN now() END,$7::jsonb,$8,$9,$10,CASE WHEN $11 THEN now() END)
       ON CONFLICT (organization_id,assignment_id,block_id) DO UPDATE SET opened_at=COALESCE(training_assignment_content_progress.opened_at,now()),completed_at=CASE WHEN $5 THEN COALESCE(training_assignment_content_progress.completed_at,now()) ELSE training_assignment_content_progress.completed_at END,acknowledged_at=CASE WHEN $6 THEN COALESCE(training_assignment_content_progress.acknowledged_at,now()) ELSE training_assignment_content_progress.acknowledged_at END,checklist_state=$7::jsonb,response_text=$8,watched_seconds=$9,last_video_position_seconds=$10,last_heartbeat_at=CASE WHEN $11 THEN now() ELSE training_assignment_content_progress.last_heartbeat_at END`,
      [
        context.organizationId,
        assignment.id,
        block.lesson_id,
        blockId,
        completed,
        acknowledged,
        JSON.stringify(checklist),
        response,
        watched,
        position,
        input.action === "heartbeat",
      ],
    );
    const required = await client.query<{ incomplete: string }>(
      `SELECT COUNT(b.id) FILTER (WHERE b.is_required AND (p.completed_at IS NULL OR (b.block_type='acknowledgment' AND p.acknowledged_at IS NULL)))::text AS incomplete
         FROM training_content_blocks b
         LEFT JOIN training_assignment_content_progress p ON p.organization_id=b.organization_id AND p.assignment_id=$3 AND p.block_id=b.id
        WHERE b.organization_id=$1 AND b.lesson_id=$2`,
      [context.organizationId, block.lesson_id, assignment.id],
    );
    const lessonStatus =
      Number(required.rows[0]?.incomplete ?? 0) === 0
        ? block.completion_mode === "supervisor_validation"
          ? "awaiting_validation"
          : "completed"
        : "in_progress";
    await client.query(
      `INSERT INTO training_assignment_lesson_progress (organization_id,assignment_id,lesson_id,status,completed_at,last_opened_at,last_block_id,last_video_position_seconds,watched_seconds) VALUES ($1,$2,$3,$4,CASE WHEN $4='completed' THEN now() END,now(),$5,$6,$7) ON CONFLICT (organization_id,assignment_id,lesson_id) DO UPDATE SET status=$4,completed_at=CASE WHEN $4='completed' THEN COALESCE(training_assignment_lesson_progress.completed_at,now()) ELSE training_assignment_lesson_progress.completed_at END,last_opened_at=now(),last_block_id=$5,last_video_position_seconds=$6,watched_seconds=$7`,
      [
        context.organizationId,
        assignment.id,
        block.lesson_id,
        lessonStatus,
        blockId,
        position,
        watched,
      ],
    );
    const assignmentProgress = await recalculateProfessionalAssignment(
      client,
      context,
      assignment,
    );
    await audit(
      client,
      context,
      assignment.course_id,
      assignment.course_version_id,
      assignment.id,
      "content_progress_saved",
      { blockId, action: input.action, completed, lessonStatus },
    );
    return {
      blockId,
      completed,
      acknowledged,
      watchedSeconds: watched,
      videoPositionSeconds: position,
      lessonStatus,
      assignment: assignmentProgress,
    };
  });
}
function normalizeAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeAnswer).sort().join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}
function quizQuestions(content: Record<string, unknown>) {
  return Array.isArray(content.questions)
    ? content.questions.filter(
        (question): question is Record<string, unknown> =>
          Boolean(question) && typeof question === "object",
      )
    : [];
}
function questionAnswer(question: Record<string, unknown>) {
  return (
    question.correctAnswer ??
    question.correctOption ??
    question.correctAnswers ??
    question.answer ??
    null
  );
}
function questionRequiresManualMarking(question: Record<string, unknown>) {
  return ["short_text", "written", "reflection"].includes(
    String(question.type ?? ""),
  );
}
async function blockForAssignment(
  client: PoolClient,
  context: TrainingContext,
  assignment: Awaited<ReturnType<typeof ownAssignment>>,
  blockId: string,
) {
  const result = await client.query<any>(
    `SELECT b.*,l.id AS lesson_id,l.completion_mode,l.is_required AS lesson_required
       FROM training_content_blocks b
       JOIN training_lessons l ON l.organization_id=b.organization_id AND l.id=b.lesson_id
      WHERE b.organization_id=$1 AND b.id=$2 AND l.version_id=$3`,
    [context.organizationId, blockId, assignment.course_version_id],
  );
  const block = result.rows[0];
  if (!block) throw new NotFoundError("Training content block not found");
  return block;
}
async function saveLessonCompletion(
  client: PoolClient,
  context: TrainingContext,
  assignment: Awaited<ReturnType<typeof ownAssignment>>,
  lessonId: string,
  lastBlockId: string,
) {
  const required = await client.query<{ incomplete: string }>(
    `SELECT COUNT(b.id) FILTER (WHERE b.is_required AND (p.completed_at IS NULL OR (b.block_type='acknowledgment' AND p.acknowledged_at IS NULL)))::text AS incomplete
       FROM training_content_blocks b
       LEFT JOIN training_assignment_content_progress p ON p.organization_id=b.organization_id AND p.assignment_id=$3 AND p.block_id=b.id
      WHERE b.organization_id=$1 AND b.lesson_id=$2`,
    [context.organizationId, lessonId, assignment.id],
  );
  const incomplete = Number(required.rows[0]?.incomplete ?? 0);
  const lesson = await client.query<{ completion_mode: string }>(
    "SELECT completion_mode FROM training_lessons WHERE organization_id=$1 AND id=$2",
    [context.organizationId, lessonId],
  );
  const lessonStatus =
    incomplete === 0
      ? lesson.rows[0]?.completion_mode === "supervisor_validation"
        ? "awaiting_validation"
        : "completed"
      : "in_progress";
  await client.query(
    `INSERT INTO training_assignment_lesson_progress (organization_id,assignment_id,lesson_id,status,completed_at,last_opened_at,last_block_id)
     VALUES ($1,$2,$3,$4,CASE WHEN $4='completed' THEN now() END,now(),$5)
     ON CONFLICT (organization_id,assignment_id,lesson_id) DO UPDATE SET status=$4,completed_at=CASE WHEN $4='completed' THEN COALESCE(training_assignment_lesson_progress.completed_at,now()) ELSE training_assignment_lesson_progress.completed_at END,last_opened_at=now(),last_block_id=$5`,
    [
      context.organizationId,
      assignment.id,
      lessonId,
      lessonStatus,
      lastBlockId,
    ],
  );
  return lessonStatus;
}

/** Grades objective answers inside the tenant transaction. Correct answers never leave this service. */
export async function submitLearnerQuiz(
  context: TrainingContext,
  assignmentId: string,
  blockId: string,
  answers: unknown[],
) {
  return withTenantContext(context, async (client) => {
    const assignment = await ownAssignment(client, context, assignmentId);
    const block = await blockForAssignment(
      client,
      context,
      assignment,
      blockId,
    );
    if (block.block_type !== "quiz")
      throw new BadRequestError("This block is not a quiz", {
        field: "blockId",
      });
    const content =
      block.content && typeof block.content === "object"
        ? (block.content as Record<string, unknown>)
        : {};
    const questions = quizQuestions(content);
    if (!questions.length)
      throw new ConflictError("This quiz has no questions", {
        field: "questions",
      });
    const previous = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM training_quiz_attempts WHERE organization_id=$1 AND assignment_id=$2 AND block_id=$3",
      [context.organizationId, assignment.id, blockId],
    );
    const maxAttempts = Math.max(1, Number(content.maxAttempts ?? 3));
    const attemptNumber = Number(previous.rows[0]?.count ?? 0) + 1;
    if (attemptNumber > maxAttempts)
      throw new ConflictError("No quiz attempts remain", { field: "attempts" });
    const manual = questions.some(questionRequiresManualMarking);
    let earned = 0;
    let available = 0;
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index]!;
      const points = Math.max(0, Number(question.points ?? 1));
      available += points;
      if (
        !questionRequiresManualMarking(question) &&
        normalizeAnswer(answers[index]) ===
          normalizeAnswer(questionAnswer(question))
      )
        earned += points;
    }
    const score = available
      ? Math.round((earned / available) * 10000) / 100
      : 0;
    const passingScore = Math.min(
      100,
      Math.max(0, Number(content.passingScore ?? 70)),
    );
    const passed = !manual && score >= passingScore;
    await client.query(
      `INSERT INTO training_quiz_attempts (organization_id,assignment_id,lesson_id,block_id,attempt_number,status,score,passed,answers,graded_at,graded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CASE WHEN $6='graded' THEN now() END,CASE WHEN $6='graded' THEN $10 END)`,
      [
        context.organizationId,
        assignment.id,
        block.lesson_id,
        blockId,
        attemptNumber,
        manual ? "awaiting_grading" : "graded",
        manual ? null : score,
        manual ? null : passed,
        JSON.stringify(answers),
        context.userId,
      ],
    );
    if (passed) {
      await client.query(
        `INSERT INTO training_assignment_content_progress (organization_id,assignment_id,lesson_id,block_id,opened_at,completed_at)
         VALUES ($1,$2,$3,$4,now(),now())
         ON CONFLICT (organization_id,assignment_id,block_id) DO UPDATE SET opened_at=COALESCE(training_assignment_content_progress.opened_at,now()),completed_at=COALESCE(training_assignment_content_progress.completed_at,now())`,
        [context.organizationId, assignment.id, block.lesson_id, blockId],
      );
      await saveLessonCompletion(
        client,
        context,
        assignment,
        block.lesson_id,
        blockId,
      );
    }
    const summary = await recalculateProfessionalAssignment(
      client,
      context,
      assignment,
    );
    if (manual)
      await notifyOrganizationOwnersInTransaction(client, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        type: "training_quiz_grading_required",
        category: "training",
        priority: "normal",
        title: "Training response needs grading",
        message: assignment.course_name,
        actionUrl: "/training",
        entityType: "training_assignment",
        entityId: assignment.id,
        deduplicationKey: `training-quiz-grading:${assignment.id}:${blockId}:${attemptNumber}`,
      });
    else
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: context.memberId,
        recipientEmployeeId: assignment.employee_id,
        actorUserId: context.userId,
        type: passed ? "training_quiz_passed" : "training_quiz_failed",
        category: "training",
        priority: passed ? "normal" : "high",
        title: passed ? "Training quiz passed" : "Training quiz not passed",
        message: assignment.course_name,
        actionUrl: `/my-trainings/${assignment.id}`,
        entityType: "training_assignment",
        entityId: assignment.id,
        deduplicationKey: `training-quiz:${assignment.id}:${blockId}:${attemptNumber}`,
      });
    await audit(
      client,
      context,
      assignment.course_id,
      assignment.course_version_id,
      assignment.id,
      manual ? "quiz_submitted_for_grading" : "quiz_graded",
      {
        blockId,
        attemptNumber,
        score: manual ? null : score,
        passed: manual ? null : passed,
      },
    );
    return {
      attemptNumber,
      maxAttempts,
      score: manual ? null : score,
      passingScore,
      passed: manual ? null : passed,
      awaitingGrading: manual,
      assignment: summary,
    };
  });
}

async function managerAssignment(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
) {
  assertManager(context);
  const result = await client.query<{
    id: string;
    employee_id: string;
    course_id: string;
    course_version_id: string | null;
    status: string;
    due_on: string | null;
    progress_percent: string;
    completion_mode: string;
    validity_months: number | null;
    course_name: string;
    course_code: string;
    course_category: string;
    course_summary: string | null;
    province_id: string | null;
    employee_member_id: string | null;
  }>(
    `SELECT a.id,a.employee_id,a.course_id,a.course_version_id,a.status,a.due_on::text,a.progress_percent::text,c.completion_mode,c.validity_months,c.name AS course_name,c.code AS course_code,c.category AS course_category,c.summary AS course_summary,e.province_id,e.member_id AS employee_member_id
       FROM training_assignments a
       JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
       JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
      WHERE a.organization_id=$1 AND a.id=$2`,
    [context.organizationId, assignmentId],
  );
  const assignment = result.rows[0];
  if (!assignment || !assignment.course_version_id)
    throw new NotFoundError("Training assignment not found");
  if (!context.isOwner && assignment.province_id) {
    const scoped = await client.query(
      "SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3",
      [context.organizationId, context.memberId, assignment.province_id],
    );
    if (!scoped.rowCount)
      throw new NotFoundError("Training assignment not found");
  }
  return assignment;
}

/** HR/training managers approve or return a manual course completion without trusting browser state. */
export async function validateProfessionalAssignment(
  context: TrainingContext,
  assignmentId: string,
  approved: boolean,
  note?: string | null,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await managerAssignment(client, context, assignmentId);
    const destination = approved ? "completed" : "in_progress";
    await client.query(
      `UPDATE training_assignments SET status=$3,completed_on=CASE WHEN $3='completed' THEN COALESCE(completed_on,CURRENT_DATE) ELSE NULL END,notes=COALESCE($4,notes) WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, assignment.id, destination, note ?? null],
    );
    if (approved)
      await issueAutomaticCertificate(
        client,
        context,
        assignment as Awaited<ReturnType<typeof ownAssignment>>,
      );
    if (assignment.employee_member_id)
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: assignment.employee_member_id,
        recipientEmployeeId: assignment.employee_id,
        actorUserId: context.userId,
        type: approved
          ? "training_completion_approved"
          : "training_completion_returned",
        category: "training",
        priority: approved ? "normal" : "high",
        title: approved
          ? "Training completion approved"
          : "Training returned for completion",
        message: note ?? assignment.course_name,
        actionUrl: `/my-trainings/${assignment.id}`,
        entityType: "training_assignment",
        entityId: assignment.id,
        deduplicationKey: `training-validation-result:${assignment.id}:${approved ? "approved" : "returned"}`,
      });
    await audit(
      client,
      context,
      assignment.course_id,
      assignment.course_version_id,
      assignment.id,
      approved ? "completion_validated" : "completion_returned",
      { note: note ?? null },
    );
    return { assignmentId: assignment.id, status: destination };
  });
}

/** Training content uses the existing private document store; an employee receives a file only when it belongs to their assigned course. */
export async function learnerBlockFile(
  context: TrainingContext,
  assignmentId: string,
  blockId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await ownAssignment(client, context, assignmentId);
    const block = await blockForAssignment(
      client,
      context,
      assignment,
      blockId,
    );
    if (!block.document_id) throw new NotFoundError("Training file not found");
    const document = await client.query<{
      storage_path: string;
      file_name: string;
      mime_type: string;
    }>(
      "SELECT storage_path,file_name,mime_type FROM documents WHERE organization_id=$1 AND id=$2 AND is_confidential=false",
      [context.organizationId, block.document_id],
    );
    const file = document.rows[0];
    if (!file) throw new NotFoundError("Training file not found");
    return {
      fileName: file.file_name,
      mimeType: file.mime_type,
      allowDownload: Boolean(block.allow_download),
      buffer: await readPrivateDocument(file.storage_path),
    };
  });
}
/** Makes an editable draft from the currently published outline. Existing assignments remain on their original version. */
export async function createCourseRevision(
  context: TrainingContext,
  courseId: string,
) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const course = await courseFor(client, context, courseId);
    if (!course.current_version_id)
      throw new NotFoundError("Course version not found");
    const existing = await client.query<{ version_number: number }>(
      "SELECT version_number FROM training_course_versions WHERE organization_id=$1 AND id=$2",
      [context.organizationId, course.current_version_id],
    );
    const sourceVersion = existing.rows[0];
    if (!sourceVersion) throw new NotFoundError("Course version not found");
    const next = await client.query<{ number: string }>(
      "SELECT (COALESCE(MAX(version_number),0) + 1)::text AS number FROM training_course_versions WHERE organization_id=$1 AND course_id=$2",
      [context.organizationId, courseId],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO training_course_versions (organization_id,course_id,version_number,status,title_snapshot,content_snapshot,created_by)
       SELECT organization_id,course_id,$3,'draft',title_snapshot,content_snapshot,$4
         FROM training_course_versions WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [
        context.organizationId,
        course.current_version_id,
        Number(next.rows[0]?.number ?? sourceVersion.version_number + 1),
        context.userId,
      ],
    );
    const versionId = version.rows[0]!.id;
    const sourceModules = await client.query<any>(
      "SELECT * FROM training_modules WHERE organization_id=$1 AND version_id=$2 ORDER BY sort_order,created_at",
      [context.organizationId, course.current_version_id],
    );
    const moduleIds = new Map<string, string>();
    for (const source of sourceModules.rows) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO training_modules (organization_id,course_id,version_id,code,title,introduction,summary,sort_order,is_required,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          context.organizationId,
          courseId,
          versionId,
          source.code,
          source.title,
          source.introduction,
          source.summary,
          source.sort_order,
          source.is_required,
          context.userId,
        ],
      );
      moduleIds.set(source.id, inserted.rows[0]!.id);
    }
    const sourceLessons = await client.query<any>(
      "SELECT * FROM training_lessons WHERE organization_id=$1 AND version_id=$2 ORDER BY sort_order,created_at",
      [context.organizationId, course.current_version_id],
    );
    const lessonIds = new Map<string, string>();
    for (const source of sourceLessons.rows) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO training_lessons (organization_id,course_id,version_id,module_id,code,title,summary,estimated_duration_minutes,sort_order,is_required,require_sequential,completion_mode,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          context.organizationId,
          courseId,
          versionId,
          moduleIds.get(source.module_id),
          source.code,
          source.title,
          source.summary,
          source.estimated_duration_minutes,
          source.sort_order,
          source.is_required,
          source.require_sequential,
          source.completion_mode,
          context.userId,
        ],
      );
      lessonIds.set(source.id, inserted.rows[0]!.id);
    }
    const sourceBlocks = await client.query<any>(
      "SELECT * FROM training_content_blocks WHERE organization_id=$1 AND lesson_id=ANY($2::uuid[]) ORDER BY sort_order,created_at",
      [
        context.organizationId,
        sourceLessons.rows.map((lesson: any) => lesson.id),
      ],
    );
    for (const source of sourceBlocks.rows)
      await client.query(
        `INSERT INTO training_content_blocks (organization_id,lesson_id,block_type,title,content,document_id,external_url,captions,transcript,minimum_watched_percent,allow_download,sort_order,is_required,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          context.organizationId,
          lessonIds.get(source.lesson_id),
          source.block_type,
          source.title,
          JSON.stringify(source.content ?? {}),
          source.document_id,
          source.external_url,
          source.captions,
          source.transcript,
          source.minimum_watched_percent,
          source.allow_download,
          source.sort_order,
          source.is_required,
          context.userId,
        ],
      );
    await audit(
      client,
      context,
      courseId,
      versionId,
      null,
      "course_revision_created",
      { copiedFrom: course.current_version_id },
    );
    return {
      courseId,
      versionId,
      versionNumber: Number(next.rows[0]?.number ?? 0),
    };
  });
}

/** Public certificate verification intentionally returns only safe certificate facts. */
export async function verifyCertificate(token: string) {
  const result = await db.query<{
    certificate_number: string;
    issued_at: Date;
    expires_on: string | null;
    revoked_at: Date | null;
    course_name: string;
    course_code: string;
    organization_name: string;
    employee_name: string;
  }>(
    `SELECT cert.certificate_number,cert.issued_at,cert.expires_on,cert.revoked_at,c.name AS course_name,c.code AS course_code,o.display_name AS organization_name,e.full_name AS employee_name
       FROM training_certificates cert
       JOIN training_courses c ON c.organization_id=cert.organization_id AND c.id=cert.course_id
       JOIN organizations o ON o.id=cert.organization_id
       JOIN employees e ON e.organization_id=cert.organization_id AND e.id=cert.employee_id
      WHERE cert.verification_token=$1`,
    [token],
  );
  const certificate = result.rows[0];
  if (!certificate) throw new NotFoundError("Certificate not found");
  const today = new Date().toISOString().slice(0, 10);
  return {
    valid:
      !certificate.revoked_at &&
      (!certificate.expires_on || certificate.expires_on >= today),
    certificate: {
      number: certificate.certificate_number,
      employeeName: certificate.employee_name,
      courseName: certificate.course_name,
      courseCode: certificate.course_code,
      organizationName: certificate.organization_name,
      issuedAt: certificate.issued_at,
      expiresOn: certificate.expires_on,
      revoked: Boolean(certificate.revoked_at),
    },
  };
}

export async function learnerCertificateFileInfo(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await ownAssignment(client, context, assignmentId);
    const result = await client.query<{
      certificate_number: string;
      issued_at: Date;
      expires_on: string | null;
      score: string | null;
      verification_token: string;
      employee_name: string;
      employee_number: string;
      organization_name: string;
      approved_by_name: string | null;
    }>(
      `SELECT cert.certificate_number,cert.issued_at,cert.expires_on,cert.score::text,cert.verification_token,e.full_name AS employee_name,e.employee_number,o.display_name AS organization_name,u.full_name AS approved_by_name
         FROM training_certificates cert
         JOIN employees e ON e.organization_id=cert.organization_id AND e.id=cert.employee_id
         JOIN organizations o ON o.id=cert.organization_id
         LEFT JOIN users u ON u.id=cert.approved_by
        WHERE cert.organization_id=$1 AND cert.assignment_id=$2 AND cert.revoked_at IS NULL`,
      [context.organizationId, assignment.id],
    );
    const certificate = result.rows[0];
    if (!certificate) throw new NotFoundError("Certificate not found");
    return {
      certificate: {
        number: certificate.certificate_number,
        issuedAt: certificate.issued_at,
        expiresOn: certificate.expires_on,
        score: certificate.score === null ? null : Number(certificate.score),
        verificationToken: certificate.verification_token,
        employeeName: certificate.employee_name,
        employeeNumber: certificate.employee_number,
        organizationName: certificate.organization_name,
        courseName: assignment.course_name,
        courseCode: assignment.course_code,
        approvedByName: certificate.approved_by_name,
      },
    };
  });
}
