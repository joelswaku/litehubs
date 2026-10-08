import type { PoolClient } from "pg";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import {
  createNotificationInTransaction,
  notifyOrganizationOwnersInTransaction,
} from "../notifications/notifications.service";
import type { TrainingContext } from "./training.service";

/**
 * Learner notes and questions about a lesson.
 *
 *  - A note is private: only the employee who wrote it can read or change it.
 *  - A question is shared with the people who manage training (owner or
 *    `training.create`), who answer it; the learner is notified of the answer.
 */

type Row = Record<string, unknown>;

function isTrainer(context: TrainingContext) {
  return context.isOwner || context.permissions.includes("training.create");
}

/** The learner's own assignment and one lesson of its course version. */
async function ownLesson(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
  lessonId: string,
) {
  const result = await client.query<{
    assignment_id: string;
    employee_id: string;
    course_id: string;
    course_name: string;
    lesson_id: string;
    lesson_title: string;
  }>(
    `SELECT a.id AS assignment_id, a.employee_id, a.course_id, c.name AS course_name,
            l.id AS lesson_id, l.title AS lesson_title
       FROM training_assignments a
       JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
       JOIN training_courses c ON c.organization_id = a.organization_id AND c.id = a.course_id
       JOIN training_lessons l ON l.organization_id = a.organization_id AND l.version_id = a.course_version_id
      WHERE a.organization_id = $1 AND a.id = $2 AND l.id = $3 AND e.member_id = $4`,
    [context.organizationId, assignmentId, lessonId, context.memberId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Training lesson not found");
  return row;
}

function questionView(row: Row) {
  return {
    id: String(row.id),
    assignmentId: String(row.assignment_id),
    lessonId: String(row.lesson_id),
    lessonTitle: row.lesson_title == null ? null : String(row.lesson_title),
    courseName: row.course_name == null ? null : String(row.course_name),
    employeeName: row.employee_name == null ? null : String(row.employee_name),
    question: String(row.question),
    answer: row.answer == null ? null : String(row.answer),
    answeredByName:
      row.answered_by_name == null ? null : String(row.answered_by_name),
    answeredAt: row.answered_at == null ? null : String(row.answered_at),
    createdAt: String(row.created_at),
  };
}

const questionSelect = `SELECT q.id, q.assignment_id, q.lesson_id, q.question, q.answer,
            to_json(q.answered_at)#>>'{}' AS answered_at, to_json(q.created_at)#>>'{}' AS created_at,
            l.title AS lesson_title, c.name AS course_name,
            NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '') AS employee_name,
            answer_user.full_name AS answered_by_name
       FROM training_lesson_questions q
       JOIN training_lessons l ON l.organization_id = q.organization_id AND l.id = q.lesson_id
       JOIN training_courses c ON c.organization_id = q.organization_id AND c.id = q.course_id
       JOIN employees e ON e.organization_id = q.organization_id AND e.id = q.employee_id
       LEFT JOIN users answer_user ON answer_user.id = q.answered_by_user_id`;

/** The learner's note and questions for one lesson. */
export async function lessonNotesAndQuestions(
  context: TrainingContext,
  assignmentId: string,
  lessonId: string,
) {
  return withTenantContext(context, async (client) => {
    const lesson = await ownLesson(client, context, assignmentId, lessonId);
    const [note, questions] = await Promise.all([
      client.query<{ note: string; updated_at: string }>(
        `SELECT note, to_json(updated_at)#>>'{}' AS updated_at FROM training_learner_notes
          WHERE organization_id = $1 AND assignment_id = $2 AND lesson_id = $3`,
        [context.organizationId, lesson.assignment_id, lesson.lesson_id],
      ),
      client.query<Row>(
        `${questionSelect}
          WHERE q.organization_id = $1 AND q.assignment_id = $2 AND q.lesson_id = $3
          ORDER BY q.created_at DESC`,
        [context.organizationId, lesson.assignment_id, lesson.lesson_id],
      ),
    ]);
    return {
      note: note.rows[0]?.note ?? "",
      noteUpdatedAt: note.rows[0]?.updated_at ?? null,
      questions: questions.rows.map(questionView),
    };
  });
}

/** Saves (or clears) the learner's private note for a lesson. */
export async function saveLessonNote(
  context: TrainingContext,
  assignmentId: string,
  lessonId: string,
  note: string,
) {
  return withTenantContext(context, async (client) => {
    const lesson = await ownLesson(client, context, assignmentId, lessonId);
    const text = note.trim();
    if (!text) {
      await client.query(
        `DELETE FROM training_learner_notes
          WHERE organization_id = $1 AND assignment_id = $2 AND lesson_id = $3`,
        [context.organizationId, lesson.assignment_id, lesson.lesson_id],
      );
      return { note: "", noteUpdatedAt: null };
    }
    const saved = await client.query<{ note: string; updated_at: string }>(
      `INSERT INTO training_learner_notes (organization_id, assignment_id, lesson_id, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, assignment_id, lesson_id)
       DO UPDATE SET note = EXCLUDED.note
       RETURNING note, to_json(updated_at)#>>'{}' AS updated_at`,
      [context.organizationId, lesson.assignment_id, lesson.lesson_id, text],
    );
    return {
      note: saved.rows[0]!.note,
      noteUpdatedAt: saved.rows[0]!.updated_at,
    };
  });
}

/** The learner asks the trainer a question about a lesson. */
export async function askLessonQuestion(
  context: TrainingContext,
  assignmentId: string,
  lessonId: string,
  question: string,
) {
  return withTenantContext(context, async (client) => {
    const lesson = await ownLesson(client, context, assignmentId, lessonId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO training_lesson_questions
         (organization_id, assignment_id, lesson_id, course_id, employee_id, asked_by_user_id, question)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        context.organizationId,
        lesson.assignment_id,
        lesson.lesson_id,
        lesson.course_id,
        lesson.employee_id,
        context.userId,
        question.trim(),
      ],
    );
    const id = inserted.rows[0]!.id;
    await notifyOrganizationOwnersInTransaction(client, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      type: "training_question_asked",
      category: "training",
      priority: "normal",
      title: "New question on a training lesson",
      message: `${lesson.course_name} · ${lesson.lesson_title}`,
      actionUrl: "/training",
      entityType: "training_assignment",
      entityId: lesson.assignment_id,
      deduplicationKey: `training-question:${id}`,
    });
    const row = await client.query<Row>(
      `${questionSelect} WHERE q.organization_id = $1 AND q.id = $2`,
      [context.organizationId, id],
    );
    return questionView(row.rows[0]!);
  });
}

/** Trainer inbox: open questions first, then the latest answered ones. */
export async function listLessonQuestions(
  context: TrainingContext,
  status: "open" | "answered" | "all" = "all",
) {
  if (!isTrainer(context))
    throw new ForbiddenError("Only a training manager can read learner questions");
  return withTenantContext(context, async (client) => {
    const filter =
      status === "open"
        ? "AND q.answered_at IS NULL"
        : status === "answered"
          ? "AND q.answered_at IS NOT NULL"
          : "";
    const rows = await client.query<Row>(
      `${questionSelect}
        WHERE q.organization_id = $1 ${filter}
        ORDER BY (q.answered_at IS NULL) DESC, q.created_at DESC
        LIMIT 200`,
      [context.organizationId],
    );
    return rows.rows.map(questionView);
  });
}

/** Trainer answers a question; the learner is notified. */
export async function answerLessonQuestion(
  context: TrainingContext,
  questionId: string,
  answer: string,
) {
  if (!isTrainer(context))
    throw new ForbiddenError("Only a training manager can answer learner questions");
  return withTenantContext(context, async (client) => {
    const updated = await client.query<{
      assignment_id: string;
      employee_id: string;
    }>(
      `UPDATE training_lesson_questions
          SET answer = $3, answered_by_user_id = $4, answered_at = now()
        WHERE organization_id = $1 AND id = $2
        RETURNING assignment_id, employee_id`,
      [context.organizationId, questionId, answer.trim(), context.userId],
    );
    const row = updated.rows[0];
    if (!row) throw new NotFoundError("Question not found");
    const member = await client.query<{ member_id: string | null }>(
      "SELECT member_id FROM employees WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.employee_id],
    );
    const memberId = member.rows[0]?.member_id;
    if (memberId)
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: memberId,
        recipientEmployeeId: row.employee_id,
        actorUserId: context.userId,
        type: "training_question_answered",
        category: "training",
        priority: "normal",
        title: "Your trainer answered your question",
        message: answer.trim().slice(0, 200),
        actionUrl: `/my-trainings/${row.assignment_id}`,
        entityType: "training_assignment",
        entityId: row.assignment_id,
        deduplicationKey: `training-question-answer:${questionId}:${Date.now()}`,
      });
    const view = await client.query<Row>(
      `${questionSelect} WHERE q.organization_id = $1 AND q.id = $2`,
      [context.organizationId, questionId],
    );
    return questionView(view.rows[0]!);
  });
}
