/**
 * S5 — the dev-fixture reset (owner-approved, plan §3 F11).
 *
 * Deletes ONLY the org with slug `demo-trust` (plus better-auth `user` rows
 * ending `@demo-trust.test`), with an optional `--fees-itg` flag for the
 * accumulated `fees-itg-%` integration-fixture orgs (and their
 * `%@fees-itg.test` users). Everything else in the database is untouched.
 *
 *   pnpm reset:demo -- --yes [--fees-itg]
 *
 * Safety rails: refuses without `--yes`; refuses when
 * `NODE_ENV=production`; prints targets and row counts BEFORE deleting.
 * Re-runnable: an already-clean database deletes zero rows and still
 * asserts the ledger trigger back in place.
 *
 * HARD RULE 3's trigger is dropped and recreated around the ledger delete —
 * this dev-fixture script is the ONLY sanctioned trigger-drop (the plan's
 * S5). The trigger's absence outside this script's window is never valid;
 * the script asserts its existence before exiting.
 *
 * Deletion order is FK-safe and matches the plan (empirically validated in
 * the Phase 4 run — do not reorder without testing): refunds before
 * payments before installments before assignments; enrollments before
 * students before guardians; config before the academic spine; authz before
 * schools before orgs; sessions/accounts/users last. The authz cache needs
 * no flush — deleted users' keys go stale-harmless on the 5-minute TTL.
 */
import { db } from "@repo/db";
import {
  academicCalendar,
  academicYears,
  account,
  attendancePolicies,
  attendanceRecords,
  attendanceSummary,
  authzAuditLog,
  classes,
  classSubjectMappings,
  dailyAttendanceStatus,
  feeConcessions,
  feeHeads,
  feeInstallments,
  feePayments,
  feeRefunds,
  feeStructureLines,
  feeStructures,
  financialTransactions,
  guardians,
  lateFeeRules,
  openingBalances,
  organizations,
  orgRolePermissions,
  paymentAllocations,
  periods,
  previousSchoolRecords,
  receiptNumberSequences,
  roleAssignments,
  schools,
  scopeNodes,
  sections,
  sectionTeacherAssignments,
  session,
  staff,
  studentEnrollments,
  studentFeeAssignments,
  studentGuardians,
  studentOptionalFeeSubscriptions,
  studentPortalAccess,
  studentRelationships,
  students,
  subjects,
  terms,
  user,
} from "@repo/db/schema";
// Phase 5 exam tables — import explicitly beside the rest of the wipe list.
import {
  examClassPublication,
  examComponents,
  examEligibility,
  examSubjectSchedules,
  exams,
  gradingScaleBands,
  gradingScales,
  annualResultPolicies,
  annualResultPolicyTerms,
  passCriteria,
  publishedReportCards,
  studentComponentResultRevisions,
  studentComponentResults,
  studentFinalResults,
  studentFinalSubjectResults,
  studentSubjectResults,
  studentTermResults,
  subjectTypes,
  termAssessments,
} from "@repo/db/schema";
// Homework/assignment domain — added after the reset was written. Child-first:
// answers/submissions before student assignments before assignment definitions
// before rubrics/questions. Keep this list in FK order when the domain grows.
import {
  assignmentAcknowledgements,
  assignmentComments,
  assignmentEvaluations,
  assignmentExtensions,
  assignmentQuestionSettings,
  assignmentQuestions,
  assignmentResources,
  assignmentRevisions,
  assignmentRubricScores,
  assignmentSeries,
  assignmentSettings,
  assignmentTargets,
  assignments,
  evaluationFiles,
  idCardTemplates,
  orgPublicSites,
  questionAttemptAnswerFiles,
  questionAttemptAnswers,
  questionAttempts,
  questionBankItems,
  questionOptions,
  reportCardTemplates,
  rubrics,
  rubricCriteria,
  rubricLevels,
  storageObjects,
  studentAssignmentSummary,
  studentAssignments,
  studentPhotos,
  submissionFiles,
  submissions,
} from "@repo/db/schema";
import { eq, inArray, like, or, sql } from "drizzle-orm";

const DEMO_SLUG = "demo-trust";
const DEMO_EMAIL_LIKE = "%@demo-trust.test";
const ITG_SLUG_LIKE = "fees-itg-%";
const ITG_EMAIL_LIKE = "%@fees-itg.test";

/**
 * Hard rule 3 is non-negotiable: the trigger is dropped only for the duration
 * of the wipe. A failed delete must not leave the window open, so the failure
 * path in `main().catch` calls this too. Idempotent (drops a trigger that may
 * already be gone, then recreates it).
 */
let ledgerTriggerDropped = false;
async function restoreLedgerTrigger() {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS financial_transactions_append_only_trg
      ON financial_transactions
  `);
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION financial_transactions_block_mutation()
    RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION
            'financial_transactions is append-only (hard rule 3): % is forbidden. Corrections are new offsetting rows.',
            TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await db.execute(sql`
    CREATE TRIGGER financial_transactions_append_only_trg
        BEFORE UPDATE OR DELETE ON "financial_transactions"
        FOR EACH ROW EXECUTE FUNCTION financial_transactions_block_mutation();
  `);
  const triggerCheck = await db.execute(sql`
    SELECT 1 FROM pg_trigger WHERE tgname = 'financial_transactions_append_only_trg'
  `);
  if ((triggerCheck as unknown as unknown[]).length === 0) {
    throw new Error("Ledger trigger was not restored — aborting loudly by design.");
  }
  ledgerTriggerDropped = false;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("reset:demo refuses to run with NODE_ENV=production.");
  }
  const argv = process.argv.slice(2);
  if (!argv.includes("--yes")) {
    throw new Error("Refusing without --yes. Run: pnpm reset:demo -- --yes [--fees-itg]");
  }
  const withItg = argv.includes("--fees-itg");

  const orgConds = withItg
    ? or(eq(organizations.slug, DEMO_SLUG), like(organizations.slug, ITG_SLUG_LIKE))
    : eq(organizations.slug, DEMO_SLUG);
  const targetOrgs = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(orgConds);
  if (targetOrgs.length === 0) {
    console.log("No target orgs found — nothing to delete (trigger still asserted below).");
  } else {
    console.log(
      `Targets: ${targetOrgs.map((o) => `${o.slug} (${o.id})`).join(", ")}`,
    );
  }
  const orgIds = targetOrgs.map((o) => o.id);

  const emailConds = withItg
    ? or(like(user.email, DEMO_EMAIL_LIKE), like(user.email, ITG_EMAIL_LIKE))
    : like(user.email, DEMO_EMAIL_LIKE);
  const targetUsers = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(emailConds);
  console.log(
    targetUsers.length === 0
      ? "No demo users found."
      : `Users: ${targetUsers.map((u) => u.email).join(", ")}`,
  );
  const userIds = targetUsers.map((u) => u.id);

  const targetSchools = orgIds.length === 0
    ? []
    : await db
      .select({ id: schools.id })
      .from(schools)
      .where(inArray(schools.organizationId, orgIds));
  const schoolIds = targetSchools.map((s) => s.id);

  const targetStudents = orgIds.length === 0
    ? []
    : await db
      .select({ id: students.id })
      .from(students)
      .where(inArray(students.organizationId, orgIds));
  const studentIds = targetStudents.map((s) => s.id);

  console.log(
    `Counts: ${orgIds.length} orgs, ${schoolIds.length} schools, ` +
      `${studentIds.length} students, ${userIds.length} users.`,
  );

  const deleted: [string, number][] = [];
  async function wipe(label: string, run: () => Promise<unknown[]>) {
    const rows = await run();
    deleted.push([label, rows.length]);
  }
  // 1. The ONLY sanctioned trigger-drop (hard rule 3).
  await db.execute(
    sql`DROP TRIGGER IF EXISTS financial_transactions_append_only_trg ON financial_transactions`,
  );
  ledgerTriggerDropped = true;

  // 2. Fees — ledger leaves first, config last.
  if (orgIds.length > 0) {
    await wipe("fee_refunds", () =>
      db.delete(feeRefunds).where(inArray(feeRefunds.organizationId, orgIds)).returning());
    await wipe("payment_allocations", () =>
      db.delete(paymentAllocations).where(inArray(paymentAllocations.organizationId, orgIds)).returning());
    await wipe("financial_transactions", () =>
      db.delete(financialTransactions).where(inArray(financialTransactions.organizationId, orgIds)).returning());
    await wipe("fee_payments", () =>
      db.delete(feePayments).where(inArray(feePayments.organizationId, orgIds)).returning());
    await wipe("fee_installments", () =>
      db.delete(feeInstallments).where(inArray(feeInstallments.organizationId, orgIds)).returning());
    await wipe("fee_concessions", () =>
      db.delete(feeConcessions).where(inArray(feeConcessions.organizationId, orgIds)).returning());
    await wipe("student_optional_fee_subscriptions", () =>
      db.delete(studentOptionalFeeSubscriptions).where(inArray(studentOptionalFeeSubscriptions.organizationId, orgIds)).returning());
    await wipe("student_fee_assignments", () =>
      db.delete(studentFeeAssignments).where(inArray(studentFeeAssignments.organizationId, orgIds)).returning());
    await wipe("opening_balances", () =>
      db.delete(openingBalances).where(inArray(openingBalances.organizationId, orgIds)).returning());
    await wipe("late_fee_rules", () =>
      db.delete(lateFeeRules).where(inArray(lateFeeRules.organizationId, orgIds)).returning());
    await wipe("fee_structure_lines", () =>
      db.delete(feeStructureLines).where(inArray(feeStructureLines.organizationId, orgIds)).returning());
    await wipe("fee_structures", () =>
      db.delete(feeStructures).where(inArray(feeStructures.organizationId, orgIds)).returning());
    await wipe("fee_heads", () =>
      db.delete(feeHeads).where(inArray(feeHeads.organizationId, orgIds)).returning());
  }
  if (schoolIds.length > 0) {
    await wipe("receipt_number_sequences", () =>
      db.delete(receiptNumberSequences).where(inArray(receiptNumberSequences.schoolId, schoolIds)).returning());
  }

  // 3. Attendance.
  if (orgIds.length > 0) {
    await wipe("attendance_records", () =>
      db.delete(attendanceRecords).where(inArray(attendanceRecords.organizationId, orgIds)).returning());
    await wipe("daily_attendance_status", () =>
      db.delete(dailyAttendanceStatus).where(inArray(dailyAttendanceStatus.organizationId, orgIds)).returning());
    await wipe("attendance_summary", () =>
      db.delete(attendanceSummary).where(inArray(attendanceSummary.organizationId, orgIds)).returning());
    await wipe("academic_calendar", () =>
      db.delete(academicCalendar).where(inArray(academicCalendar.organizationId, orgIds)).returning());
    await wipe("section_teacher_assignments", () =>
      db.delete(sectionTeacherAssignments).where(inArray(sectionTeacherAssignments.organizationId, orgIds)).returning());
    await wipe("periods", () =>
      db.delete(periods).where(inArray(periods.organizationId, orgIds)).returning());
    await wipe("attendance_policies", () =>
      db.delete(attendancePolicies).where(inArray(attendancePolicies.organizationId, orgIds)).returning());
  }

  // 4. People — portal and guardian links before enrollments before students.
  // Phase 5 first: the computed exam chain references students (and cards
  // reference terms), so the exam world leaves before the people do.
  if (orgIds.length > 0) {
    await wipe("student_component_result_revisions", () =>
      db.delete(studentComponentResultRevisions).where(inArray(studentComponentResultRevisions.organizationId, orgIds)).returning());
    await wipe("student_component_results", () =>
      db.delete(studentComponentResults).where(inArray(studentComponentResults.organizationId, orgIds)).returning());
    await wipe("student_subject_results", () =>
      db.delete(studentSubjectResults).where(inArray(studentSubjectResults.organizationId, orgIds)).returning());
    await wipe("student_final_subject_results", () =>
      db.delete(studentFinalSubjectResults).where(inArray(studentFinalSubjectResults.organizationId, orgIds)).returning());
    await wipe("student_final_results", () =>
      db.delete(studentFinalResults).where(inArray(studentFinalResults.organizationId, orgIds)).returning());
    await wipe("student_term_results", () =>
      db.delete(studentTermResults).where(inArray(studentTermResults.organizationId, orgIds)).returning());
    await wipe("term_assessments", () =>
      db.delete(termAssessments).where(inArray(termAssessments.organizationId, orgIds)).returning());
    await wipe("published_report_cards", () =>
      db.delete(publishedReportCards).where(inArray(publishedReportCards.organizationId, orgIds)).returning());
    await wipe("report_card_templates", () =>
      db.delete(reportCardTemplates).where(inArray(reportCardTemplates.organizationId, orgIds)).returning());
    await wipe("exam_class_publication", () =>
      db.delete(examClassPublication).where(inArray(examClassPublication.organizationId, orgIds)).returning());
    // The annual policies: final results (above) reference them, so they go after.
    await wipe("annual_result_policy_terms", () =>
      db.delete(annualResultPolicyTerms).where(inArray(annualResultPolicyTerms.organizationId, orgIds)).returning());
    await wipe("annual_result_policies", () =>
      db.delete(annualResultPolicies).where(inArray(annualResultPolicies.organizationId, orgIds)).returning());
    await wipe("pass_criteria", () =>
      db.delete(passCriteria).where(inArray(passCriteria.organizationId, orgIds)).returning());
    await wipe("exam_eligibility", () =>
      db.delete(examEligibility).where(inArray(examEligibility.organizationId, orgIds)).returning());
    await wipe("exam_components", () =>
      db.delete(examComponents).where(inArray(examComponents.organizationId, orgIds)).returning());
    await wipe("exam_subject_schedules", () =>
      db.delete(examSubjectSchedules).where(inArray(examSubjectSchedules.organizationId, orgIds)).returning());
    await wipe("exams", () =>
      db.delete(exams).where(inArray(exams.organizationId, orgIds)).returning());
    // 4a. Homework/assignments — leaves first. These reference enrollments,
    // students, sections, subjects and grading scales, so the whole block must
    // leave before the academic spine and before grading_scales below.
    await wipe("question_attempt_answer_files", () =>
      db.delete(questionAttemptAnswerFiles).where(inArray(questionAttemptAnswerFiles.organizationId, orgIds)).returning());
    await wipe("question_attempt_answers", () =>
      db.delete(questionAttemptAnswers).where(inArray(questionAttemptAnswers.organizationId, orgIds)).returning());
    await wipe("question_attempts", () =>
      db.delete(questionAttempts).where(inArray(questionAttempts.organizationId, orgIds)).returning());
    // student_assignments.current_evaluation_id -> assignment_evaluations is a
    // cycle; unlink it before the evaluations leave.
    await wipe("student_assignments_clear_current_evaluation", () =>
      db.update(studentAssignments)
        .set({ currentEvaluationId: null })
        .where(inArray(studentAssignments.organizationId, orgIds))
        .returning({ id: studentAssignments.id }));
    await wipe("assignment_rubric_scores", () =>
      db.delete(assignmentRubricScores).where(inArray(assignmentRubricScores.organizationId, orgIds)).returning());
    await wipe("evaluation_files", () =>
      db.delete(evaluationFiles).where(inArray(evaluationFiles.organizationId, orgIds)).returning());
    await wipe("assignment_evaluations", () =>
      db.delete(assignmentEvaluations).where(inArray(assignmentEvaluations.organizationId, orgIds)).returning());
    await wipe("submission_files", () =>
      db.delete(submissionFiles).where(inArray(submissionFiles.organizationId, orgIds)).returning());
    await wipe("submissions", () =>
      db.delete(submissions).where(inArray(submissions.organizationId, orgIds)).returning());
    await wipe("assignment_comments", () =>
      db.delete(assignmentComments).where(inArray(assignmentComments.organizationId, orgIds)).returning());
    await wipe("assignment_acknowledgements", () =>
      db.delete(assignmentAcknowledgements).where(inArray(assignmentAcknowledgements.organizationId, orgIds)).returning());
    await wipe("assignment_extensions", () =>
      db.delete(assignmentExtensions).where(inArray(assignmentExtensions.organizationId, orgIds)).returning());
    await wipe("assignment_question_settings", () =>
      db.delete(assignmentQuestionSettings).where(inArray(assignmentQuestionSettings.organizationId, orgIds)).returning());
    await wipe("assignment_questions", () =>
      db.delete(assignmentQuestions).where(inArray(assignmentQuestions.organizationId, orgIds)).returning());
    await wipe("assignment_resources", () =>
      db.delete(assignmentResources).where(inArray(assignmentResources.organizationId, orgIds)).returning());
    await wipe("assignment_revisions", () =>
      db.delete(assignmentRevisions).where(inArray(assignmentRevisions.organizationId, orgIds)).returning());
    await wipe("assignment_targets", () =>
      db.delete(assignmentTargets).where(inArray(assignmentTargets.organizationId, orgIds)).returning());
    await wipe("student_assignments", () =>
      db.delete(studentAssignments).where(inArray(studentAssignments.organizationId, orgIds)).returning());
    await wipe("student_assignment_summary", () =>
      db.delete(studentAssignmentSummary).where(inArray(studentAssignmentSummary.organizationId, orgIds)).returning());
    await wipe("assignments", () =>
      db.delete(assignments).where(inArray(assignments.organizationId, orgIds)).returning());
    await wipe("assignment_series", () =>
      db.delete(assignmentSeries).where(inArray(assignmentSeries.organizationId, orgIds)).returning());
    await wipe("assignment_settings", () =>
      db.delete(assignmentSettings).where(inArray(assignmentSettings.organizationId, orgIds)).returning());
    await wipe("rubric_levels", () =>
      db.delete(rubricLevels).where(inArray(rubricLevels.organizationId, orgIds)).returning());
    await wipe("rubric_criteria", () =>
      db.delete(rubricCriteria).where(inArray(rubricCriteria.organizationId, orgIds)).returning());
    await wipe("rubrics", () =>
      db.delete(rubrics).where(inArray(rubrics.organizationId, orgIds)).returning());
    await wipe("question_options", () =>
      db.delete(questionOptions).where(inArray(questionOptions.organizationId, orgIds)).returning());
    await wipe("question_bank_items", () =>
      db.delete(questionBankItems).where(inArray(questionBankItems.organizationId, orgIds)).returning());
    await wipe("grading_scale_bands", () =>
      db.delete(gradingScaleBands).where(inArray(gradingScaleBands.organizationId, orgIds)).returning());
    await wipe("grading_scales", () =>
      db.delete(gradingScales).where(inArray(gradingScales.organizationId, orgIds)).returning());
  }
  if (studentIds.length > 0) {
    await wipe("student_portal_access", () =>
      db.delete(studentPortalAccess).where(inArray(studentPortalAccess.studentId, studentIds)).returning());
    await wipe("student_guardians", () =>
      db.delete(studentGuardians).where(inArray(studentGuardians.studentId, studentIds)).returning());
    await wipe("student_relationships", () =>
      db.delete(studentRelationships).where(inArray(studentRelationships.studentId, studentIds)).returning());
    await wipe("previous_school_records", () =>
      db.delete(previousSchoolRecords).where(inArray(previousSchoolRecords.studentId, studentIds)).returning());
    await wipe("student_photos", () =>
      db.delete(studentPhotos).where(inArray(studentPhotos.studentId, studentIds)).returning());
  }
  if (userIds.length > 0) {
    await wipe("student_portal_access_by_user", () =>
      db.delete(studentPortalAccess).where(inArray(studentPortalAccess.userId, userIds)).returning());
  }
  if (orgIds.length > 0) {
    await wipe("student_enrollments", () =>
      db.delete(studentEnrollments).where(inArray(studentEnrollments.organizationId, orgIds)).returning());
    await wipe("students", () =>
      db.delete(students).where(inArray(students.organizationId, orgIds)).returning());
    await wipe("guardians", () =>
      db.delete(guardians).where(inArray(guardians.organizationId, orgIds)).returning());
    await wipe("staff", () =>
      db.delete(staff).where(inArray(staff.organizationId, orgIds)).returning());
  }

  // 5. Academic spine. Mappings FK subject_types, so they go FIRST — the
  // seed's term_grade type gave the demo world its first subject_types row
  // and exposed this ordering.
  if (orgIds.length > 0) {
    await wipe("class_subject_mappings", () =>
      db.delete(classSubjectMappings).where(inArray(classSubjectMappings.organizationId, orgIds)).returning());
    await wipe("subject_types", () =>
      db.delete(subjectTypes).where(inArray(subjectTypes.organizationId, orgIds)).returning());
    await wipe("subjects", () =>
      db.delete(subjects).where(inArray(subjects.organizationId, orgIds)).returning());
    await wipe("sections", () =>
      db.delete(sections).where(inArray(sections.organizationId, orgIds)).returning());
    await wipe("terms", () =>
      db.delete(terms).where(inArray(terms.organizationId, orgIds)).returning());
    await wipe("academic_years", () =>
      db.delete(academicYears).where(inArray(academicYears.organizationId, orgIds)).returning());
    await wipe("classes", () =>
      db.delete(classes).where(inArray(classes.organizationId, orgIds)).returning());
  }

  // 6. Authz, then the orgs themselves.
  if (orgIds.length > 0) {
    await wipe("scope_nodes", () =>
      db.delete(scopeNodes).where(inArray(scopeNodes.organizationId, orgIds)).returning());
    await wipe("role_assignments", () =>
      db.delete(roleAssignments).where(inArray(roleAssignments.organizationId, orgIds)).returning());
    await wipe("org_role_permissions", () =>
      db.delete(orgRolePermissions).where(inArray(orgRolePermissions.organizationId, orgIds)).returning());
    await wipe("authz_audit_log", () =>
      db.delete(authzAuditLog).where(inArray(authzAuditLog.organizationId, orgIds)).returning());
    await wipe("storage_objects", () =>
      db.delete(storageObjects).where(inArray(storageObjects.organizationId, orgIds)).returning());
    await wipe("id_card_templates", () =>
      db.delete(idCardTemplates).where(inArray(idCardTemplates.organizationId, orgIds)).returning());
    await wipe("org_public_sites", () =>
      db.delete(orgPublicSites).where(inArray(orgPublicSites.organizationId, orgIds)).returning());
    await wipe("schools", () =>
      db.delete(schools).where(inArray(schools.organizationId, orgIds)).returning());
    await wipe("organizations", () =>
      db.delete(organizations).where(inArray(organizations.id, orgIds)).returning());
  }

  // 7. Identity last (sessions/accounts cascade, deleted explicitly for the counts).
  if (userIds.length > 0) {
    // A demo user may hold a role outside demo-trust (the public-site org is
    // the known case). Remove their assignments wherever they live before the
    // user row leaves.
    await wipe("role_assignments_by_user", () =>
      db.delete(roleAssignments).where(or(
        inArray(roleAssignments.userId, userIds),
        inArray(roleAssignments.grantedBy, userIds),
        inArray(roleAssignments.revokedBy, userIds),
      )).returning());
    await wipe("authz_audit_log_by_user", () =>
      db.delete(authzAuditLog).where(or(
        inArray(authzAuditLog.actorUserId, userIds),
        inArray(authzAuditLog.targetUserId, userIds),
      )).returning());
    await wipe("session", () =>
      db.delete(session).where(inArray(session.userId, userIds)).returning());
    await wipe("account", () =>
      db.delete(account).where(inArray(account.userId, userIds)).returning());
    await wipe("user", () =>
      db.delete(user).where(inArray(user.id, userIds)).returning());
  }

  // 8. Restore the ledger trigger and ASSERT it exists.
  await restoreLedgerTrigger();

  console.log("\nDeleted rows per table:");
  for (const [label, n] of deleted) console.log(`  ${label}: ${n}`);
  const total = deleted.reduce((a, [, n]) => a + n, 0);
  console.log(`Total: ${total} rows. Ledger trigger restored and asserted.`);
  console.log("Redis note: deleted users' authz cache keys go stale-harmless on the 5-minute TTL; no flush needed.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  if (ledgerTriggerDropped) {
    try {
      await restoreLedgerTrigger();
      console.error("Ledger trigger restored after the failed reset.");
    } catch (restoreErr) {
      console.error("FAILED TO RESTORE THE LEDGER TRIGGER:", restoreErr);
    }
  }
  process.exit(1);
});
