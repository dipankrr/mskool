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

// Students: the identity registry — written once at admission, read through
// the year anchor everywhere else.
export * from "./contracts/student.contract";

// Guardians: parents' contact truth; family logins follow automatically.
export * from "./contracts/guardian.contract";

// Attendance: the calendar (marking gate), the school's marking policy, and
// the period structure. The record-layer schemas land with the marking flow.
export * from "./contracts/attendance.contract";

// Fees: the configuration vocabulary (heads, structures, lines, late-fee
// rules, subscriptions, concessions). The billing and collection schemas
// land with F4/F5. Phase 4.
export * from "./contracts/fees.contract";

// Exams: subject types, blueprint, the marks pipeline, the computed chain,
// publication + the versioned snapshot. Phase 5 (ADR-032).
export * from "./contracts/exam.contract";

// Portal access: the family login's credential lifecycle (ADR-007).
export * from "./contracts/portal-access.contract";

// Staff: the employment register and its login provisioning (ADR-008, ADR-035).
export * from "./contracts/staff.contract";

// Roles: role assignments and the read-only permission matrix (ADR-005).
export * from "./contracts/role.contract";

// ID cards: the template document vocabulary (percent-geometry elements) and
// the card-data payload it binds into. Slice 2a.
export * from "./contracts/id_card.contract";
