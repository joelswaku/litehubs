/** « Fiche d'évaluation » PDF for one performance review (shared LiteHubs layout). */
import { createPdf, pdfDate } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import { reviewSheet, type PerformanceContext } from "./performance.service";

const REVIEW_TYPE: Record<string, string> = {
  probation: "Fin de période d'essai",
  quarterly: "Trimestrielle",
  half_year: "Semestrielle",
  annual: "Annuelle",
  promotion: "Promotion",
  exit: "Départ",
};
const REVIEW_STATUS: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise à l'employé",
  acknowledged: "Prise de connaissance par l'employé",
  closed: "Clôturée",
};
const GOAL_STATUS: Record<string, string> = {
  not_started: "Non commencé",
  in_progress: "En cours",
  achieved: "Atteint",
  cancelled: "Annulé",
};
const LEVEL: Record<string, string> = {
  excellent: "Excellent",
  good: "Bon",
  medium: "Moyen",
  needs_improvement: "À améliorer",
  critical: "Critique",
  not_enough_data: "Données insuffisantes",
};

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${Math.round(value)} %`;
const pick = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? value.replace(/_/g, " ")) : null;

export async function reviewSheetPdf(
  context: PerformanceContext,
  reviewId: string,
  options: { selfOnly?: boolean } = {},
) {
  const { review, goals, indicators } = await reviewSheet(context, reviewId, options);
  const buffer = await withTenantContext(context, async (client) => {
    const pdf = await createPdf(client, context.organizationId, {
      title: "Fiche d'évaluation",
      subtitle: `${review.employee.fullName} · ${pdfDate(review.periodStart)} - ${pdfDate(review.periodEnd)}`,
      reference: review.employee.employeeNumber,
    });

    pdf.section("Employé évalué").fields([
      ["Nom complet", review.employee.fullName],
      ["Matricule", review.employee.employeeNumber],
      ["Poste", review.employee.jobTitle],
      ["Site / province", [review.site?.name, review.province?.name].filter(Boolean).join(" · ") || null],
    ]);

    pdf.section("Évaluation").fields([
      ["Type d'évaluation", pick(REVIEW_TYPE, review.reviewType)],
      ["Statut", pick(REVIEW_STATUS, review.status)],
      ["Période", `${pdfDate(review.periodStart)} au ${pdfDate(review.periodEnd)}`],
      ["Date de l'entretien", review.reviewedOn ? pdfDate(review.reviewedOn) : null],
      ["Évaluateur", review.reviewer?.fullName],
      ["Prise de connaissance", review.acknowledgedAt ? pdfDate(review.acknowledgedAt, true) : null],
    ]);

    pdf.stats([
      ["Note globale", review.overallRating === null ? "—" : `${review.overallRating} / 5`],
      ["Objectifs atteints", `${review.achievedGoalCount} / ${review.goalCount}`],
      ["Score automatique", percent(indicators?.score?.score)],
      ["Niveau", pick(LEVEL, indicators?.score?.level) ?? "—"],
    ]);

    if (indicators?.score) {
      const { policy, score } = indicators;
      pdf.section("Critères mesurés sur la période");
      pdf.table(
        [
          { label: "Critère", width: 2.2 },
          { label: "Poids", width: 0.8, align: "right" },
          { label: "Constat", width: 2.6 },
          { label: "Score", width: 0.9, align: "right" },
        ],
        [
          ["Présence", `${policy.attendanceWeight} %`, `${score.attendance.presentDays + score.attendance.lateDays} jour(s) présent(s) sur ${score.attendance.scheduledDays} prévu(s) · ${score.attendance.absentDays} absence(s)`, percent(score.components.attendance)],
          ["Ponctualité", `${policy.punctualityWeight} %`, `${score.attendance.lateDays} retard(s)`, percent(score.components.punctuality)],
          ["Rapports quotidiens", `${policy.dailyReportWeight} %`, `${score.dailyReports.submitted} soumis sur ${score.dailyReports.expected} attendu(s) · ${score.dailyReports.flagged} signalé(s)`, percent(score.components.dailyReports)],
          ["Tâches affectées", `${policy.taskWeight} %`, `${score.tasks.completed} terminée(s) sur ${score.tasks.assigned} · ${score.tasks.overdue} en retard`, percent(score.components.tasks)],
          ["Conduite", `${policy.conductWeight} %`, `${score.conduct.minorActions + score.conduct.seriousActions + score.conduct.grossActions} mesure(s) disciplinaire(s) confirmée(s)`, percent(score.components.conduct)],
        ],
        { totals: ["Score pondéré", "100 %", score.provisional ? "Provisoire (observations insuffisantes)" : `${score.observations} observation(s)`, percent(score.score)] },
      );
    }

    pdf.section("Appréciation de l'évaluateur");
    pdf.fields([["Points forts", review.strengths]], 1);
    pdf.fields([["Axes d'amélioration", review.areasToImprove]], 1);
    pdf.fields([["Objectifs fixés", review.goals]], 1);

    if (goals) {
      pdf.section("Objectifs suivis");
      pdf.table(
        [
          { label: "Objectif", width: 3 },
          { label: "Cible", width: 2 },
          { label: "Échéance", width: 1.1 },
          { label: "Poids", width: 0.8, align: "right" },
          { label: "Avanc.", width: 1, align: "right" },
          { label: "Statut", width: 1.2 },
        ],
        goals.map((goal) => [
          goal.description ? `${goal.title}\n${goal.description}` : goal.title,
          goal.target,
          goal.dueOn ? pdfDate(goal.dueOn) : null,
          goal.weight === null ? null : `${goal.weight}`,
          `${Math.round(goal.progress)} %`,
          pick(GOAL_STATUS, goal.status),
        ]),
        { empty: "Aucun objectif enregistré pour cette évaluation." },
      );
    }

    pdf.section("Commentaires de l'employé");
    pdf.paragraph(review.employeeComments || "—");

    pdf.signatures(["Employé", "Évaluateur"]);
    return pdf.finish();
  });
  const name = review.employee.fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return { buffer, fileName: `fiche-evaluation-${name}-${review.periodEnd}.pdf` };
}
