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
export * from "./enrollment-status";
export * from "./enrollment.service";

// Attendance: calendar (the marking gate), marking policy, periods. The
// marking flow and the record layer append to this file in C5.
export * from "./attendance.service";
// How attendance is counted (ADR-061): the pure rules and the "so far" read.
export * from "./attendance-counting";
export * from "./attendance-to-date";

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
export * from "./fees-dashboard.service";

// Fees: printed documents. The API fills a template and returns HTML; the client
// turns it into a PDF. Templates live here so a layout fix needs no app release.
export * from "./fee-documents/amount-words";
export * from "./fee-documents.service";
export * from "./exams-maths";

// Exams: config/blueprint/lifecycle, the marks pipeline, and the compute/
// publication engine. Phase 4 (B4).
export * from "./exam-config.service";
export * from "./exam-marks.service";
export * from "./exam-results.service";
export * from "./exam-annual.service";
export * from "./service-error";

// Portal access: the family login's credential lifecycle (ADR-007) —
// activation, password reset, and the phone change (audit + revocation).
export * from "./portal-access.service";

// Guardians: parents' contact truth; family logins follow automatically.
export * from "./guardian.service";

// Staff: the employment register and its login provisioning (ADR-035).
export * from "./staff.service";

// Roles: granting, revoking, and reading role assignments (ADR-005, ADR-035).
export * from "./role.service";

// Storage (ADR-063): files in S3-compatible buckets — upload links, processing,
// attaching, read links — and the sweeper that deletes what nothing uses.
export * from "./storage.service";
export * from "./storage-worker.service";
export {
  MemoryObjectStore,
  StorageNotConfiguredError,
  getObjectStore,
  setObjectStoreForTests,
  type ObjectStore,
} from "./storage/object-store";

// ID cards: template CRUD, the starter-design adopt, and the card-data
// resolver the print page renders against. Slice 2a.
export * from "./idcard.service";
// Printing ID cards from the phone: the Students list in, finished HTML out.
export * from "./id-card-print.service";

// Homework: give, check, the student side. ADR-039, rebuilt by ADR-064.
export * from "./homework.service";
export * from "./homework-rules";

// Homework questions: the bank, the per-quiz snapshot, one attempt per child
// and the auto-marking engine.
export * from "./homework-questions.service";

// Homework sweeper (ADR-040): scheduled giving, quiz hand-in at close, missing
// work. Idempotent, Redis-leased.
export * from "./homework-worker.service";

// Public sites: the org website engine — draft/publish split, the anonymous
// published-snapshot read. ADR-041.
export * from "./public-site.service";

// Family reads (ADR-062): the child resolver every portal read starts from,
// the attendance ranking rules, and the family attendance reads.
export * from "./portal-child";
export * from "./attendance-ranking";
export * from "./portal-attendance.service";
export * from "./portal-fees.service";
export * from "./portal-exam-schedule.service";
