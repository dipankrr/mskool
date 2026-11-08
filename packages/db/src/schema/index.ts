// The barrel drizzle-kit reads (see drizzle.config.ts `schema`) and the one
// client.ts passes to drizzle() for relational queries. A table missing from
// here is invisible to migrations — add every new domain file.

// better-auth's own tables. Text ids, not uuid (hard rule 10).
export * from "./auth";

// The tenant: organizations (the Trust) → schools (branches). ADR-001.
export * from "./organization";

// Authorization: the scope tree, per-org permissions, role assignments, audit.
export * from "./authz";

// People: staff, guardians, students, and the student portal access map.
export * from "./people";

// Academic structure: academic years → classes → sections. Phase 2.
export * from "./academic";

// Attendance: the calendar (marking gate), policy, periods — and in 0008 the
// record layer. Phase 3.
export * from "./attendance";

// Fees: heads → structures → lines, late-fee rules — and in 0011 the
// assignment/billing/collection/ledger layers. Phase 4.
export * from "./fees";

// Exams: subject types -> exams -> components; the marks pipeline; the
// computed chain; published cards. Phase 5 (ADR-032).
export * from "./exam";

// Storage: metadata for files kept in S3-compatible buckets (ADR-063) and the
// student photo that points at one.
export * from "./storage";

// ID cards: per-school student ID card templates. Slice 2a.
export * from "./idcard";

// Public sites: the org's website at {slug}.mskool.in. ADR-041.
export * from "./publicsite";

// Homework: assignments → targets → student_assignments (with the check
// result) → one submission each; the question bank and one-attempt quizzes.
// ADR-039, rebuilt by ADR-064.
export * from "./homework";
