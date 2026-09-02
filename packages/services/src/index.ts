/**
 * @repo/services — business logic. Classes plus an exported singleton each.
 *
 * No HTTP awareness here: no request, no response, no tRPC types. Services
 * take a DataScope as a required argument and filter every query by it
 * (hard rule 1), which is what makes a missing tenancy filter a compile error.
 */

export * from "./organization.service";

// The signed-in caller's own access. Takes an already-loaded auth cache rather
// than a DataScope: here the scope is the answer, not an argument.
export * from "./identity.service";

// Academic years, classes, sections — the time and structure dimensions every
// later domain hangs off.
export * from "./academic.service";

// The school's subject catalogue. School-level like years and classes; the
// subject-authority check (checkSubjectAccess) arrives with marks, S3.
export * from "./subject.service";

// The teaching-assignment layer: which subjects a class takes in a year, and
// who teaches what where — the fact checkSubjectAccess reads (ADR-012).
export * from "./assignment.service";



// Terms: the subdivisions of an academic year — the school-level time slices
// the exam chain and the term screens hang off.
export * from "./term.service";

// Students: the B6 adapter for the student's owning branch. The full
// staff/portal surface lands with the enrollment slice (S5).
export * from "./student.service";

// Enrollments: the year anchor — staff track by scope, portal track by owned
// studentId. Hard rule 6's interface half lives here.
export * from "./enrollment.service";

// Attendance: calendar (the marking gate), marking policy, periods. The
// marking flow and the record layer append to this file in C5.
export * from "./attendance.service";

// Fees: the configuration layer — heads, structures, lines, late-fee rules,
// subscriptions, concessions. The billing engine (F4) and collection (F5)
// are their own files. Phase 4.
export * from "./fees.service";

// Fees: the billing engine — assignment resolution, the idempotent
// installment generator, concession re-apportionment, opening balances.
// The pure maths lives in fees-maths (no db imports, hermetically tested).
export * from "./fees-maths";
export * from "./fees-billing.service";

// Fees: collection and the ledger — recordPayment (row-locked, idempotent),
// the named status transitions, refunds, waivers, the gateway system path.
export * from "./fees-collection.service";
