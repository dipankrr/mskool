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
