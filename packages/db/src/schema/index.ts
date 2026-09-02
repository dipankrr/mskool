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
