/**
 * @repo/contracts — the shared vocabulary.
 *
 * Zod schemas derived from the Drizzle tables via drizzle-zod, so validation
 * and the database cannot drift: rename a column and this package stops
 * compiling, which is the point of the type chain (AGENTS.md).
 */

// Auth: registration and profile input shapes used by the web app's forms.
export * from "./contracts/auth.contract";

// The tenant: organizations (the Trust) and the schools beneath them.
export * from "./contracts/organization.contract";

// The signed-in caller: which orgs they hold a role in, and what they may see
// inside each. The client's first call after sign-in.
export * from "./contracts/me.contract";

// Academic structure: years, classes, sections.
export * from "./contracts/academic.contract";

// Subjects: the school's subject catalogue.
export * from "./contracts/subject.contract";

// The teaching-assignment layer: which subjects a class takes in a year, and
// who teaches what where — the fact checkSubjectAccess reads (ADR-012).
export * from "./contracts/assignment.contract";




// Terms: the subdivisions of an academic year the exam chain reads.
export * from "./contracts/term.contract";

// Enrollments: the year anchor — one row per student per academic year.
export * from "./contracts/enrollment.contract";
