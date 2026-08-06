import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, schools } from "./organization";

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const staffStatusEnum = pgEnum("staff_status", [
  "active",
  "on_leave",
  "suspended",
  "resigned",
  "retired",
  "terminated",
]);

/**
 * Employment identity for a staff member. Distinct from `user`, which is only
 * the login: a staff member exists as an employee record whether or not they
 * ever sign in, and keeping the two apart means an employment record survives
 * a login being disabled.
 *
 * What a staff member may DO lives in role_assignments, never here.
 */
export const staff = pgTable(
  "staff",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    // Primary posting. Staff shared across branches get additional
    // role_assignments rather than duplicate staff rows.
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // Nullable: a staff record can be created before an account is issued.
    userId: text().references(() => user.id),

    employeeCode: varchar({ length: 50 }).notNull(),

    firstName: varchar({ length: 100 }).notNull(),
    middleName: varchar({ length: 100 }),
    lastName: varchar({ length: 100 }).notNull(),

    gender: genderEnum(),
    dateOfBirth: date(),

    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    addressLine1: varchar({ length: 255 }),
    addressLine2: varchar({ length: 255 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),
    pincode: varchar({ length: 10 }),

    designation: varchar({ length: 100 }),
    department: varchar({ length: 100 }),
    qualification: text(),

    dateOfJoining: date(),
    dateOfLeaving: date(),

    // Never hard-deleted (hard rule 2) — a resigned teacher still has to
    // resolve as the author of last year's attendance and marks.
    status: staffStatusEnum().notNull().default("active"),

    photoUrl: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("staff_org_employee_code_uq").on(t.organizationId, t.employeeCode),
    index("staff_school_idx").on(t.schoolId),
    index("staff_user_idx").on(t.userId),
  ],
);

/**
 * A parent or guardian. Contact record only — guardians have NO login
 * (ADR-006). The family reaches the system through the student account.
 */
export const guardians = pgTable(
  "guardians",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    firstName: varchar({ length: 100 }).notNull(),
    lastName: varchar({ length: 100 }),

    // The number fee reminders and result notifications go to, and the one a
    // parent uses to log in to the portal — as the student's account.
    phone: varchar({ length: 20 }).notNull(),
    alternatePhone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),

    occupation: varchar({ length: 100 }),
    annualIncome: varchar({ length: 50 }),
    qualification: varchar({ length: 100 }),

    addressLine1: varchar({ length: 255 }),
    addressLine2: varchar({ length: 255 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),
    pincode: varchar({ length: 10 }),

    // Government ID, used for scholarship and RTE paperwork.
    aadhaarNumber: varchar({ length: 12 }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("guardians_org_idx").on(t.organizationId),
    index("guardians_phone_idx").on(t.phone),
  ],
);

export const studentStatusEnum = pgEnum("student_status", [
  "active",
  "inactive",
  "graduated",
  "transferred_out",
  "withdrawn",
  "expelled",
]);

export const bloodGroupEnum = pgEnum("blood_group", [
  "a_positive",
  "a_negative",
  "b_positive",
  "b_negative",
  "o_positive",
  "o_negative",
  "ab_positive",
  "ab_negative",
]);

/**
 * Admission identity — who this child is, permanently. Deliberately holds
 * nothing year-specific: class, section, and roll number live on
 * student_enrollments, one row per academic year (hard rule 6).
 *
 * No userId column (ADR-008). Portal access is many-to-many through
 * student_portal_access, so one parent login can cover several children.
 */
export const students = pgTable(
  "students",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // Permanent, school-issued, never reused. Printed on every document.
    admissionNumber: varchar({ length: 50 }).notNull(),
    admissionDate: date(),

    firstName: varchar({ length: 100 }).notNull(),
    middleName: varchar({ length: 100 }),
    lastName: varchar({ length: 100 }).notNull(),

    dateOfBirth: date().notNull(),
    gender: genderEnum().notNull(),
    bloodGroup: bloodGroupEnum(),

    nationality: varchar({ length: 100 }),
    religion: varchar({ length: 100 }),
    // Reported in UDISE+ and used for RTE quota tracking.
    category: varchar({ length: 50 }),
    motherTongue: varchar({ length: 100 }),

    aadhaarNumber: varchar({ length: 12 }),

    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    addressLine1: varchar({ length: 255 }),
    addressLine2: varchar({ length: 255 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),
    pincode: varchar({ length: 10 }),

    medicalConditions: text(),
    emergencyContactName: varchar({ length: 255 }),
    emergencyContactPhone: varchar({ length: 20 }),

    photoUrl: text(),

    // Hard rule 2: a student who leaves becomes 'transferred_out', never a
    // DELETE. Their fee history and results must stay reachable.
    status: studentStatusEnum().notNull().default("active"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("students_school_admission_number_uq").on(
      t.schoolId,
      t.admissionNumber,
    ),
    index("students_org_idx").on(t.organizationId),
    index("students_school_status_idx").on(t.schoolId, t.status),
  ],
);

export const guardianRelationEnum = pgEnum("guardian_relation", [
  "father",
  "mother",
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "brother",
  "sister",
  "legal_guardian",
  "other",
]);

/**
 * Student ↔ guardian, dated. A guardian may have several children here, and a
 * student several guardians.
 *
 * Dated rather than mutated: when custody changes, the old row is closed with
 * `endedOn` and a new one opened, so it stays possible to answer "who was the
 * emergency contact in March".
 */
export const studentGuardians = pgTable(
  "student_guardians",
  {
    id: uuid().primaryKey().defaultRandom(),

    studentId: uuid()
      .notNull()
      .references(() => students.id),
    guardianId: uuid()
      .notNull()
      .references(() => guardians.id),

    relation: guardianRelationEnum().notNull(),

    // The guardian fee receipts are addressed to and notifications default to.
    isPrimary: boolean().notNull().default(false),
    // Distinct from isPrimary: the person who may collect the child from
    // school, which is not always the person who pays.
    isEmergencyContact: boolean().notNull().default(false),
    // Whether this guardian's phone can hold portal access for this student.
    canAccessPortal: boolean().notNull().default(true),

    startedOn: date(),
    endedOn: date(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("student_guardians_student_idx").on(t.studentId),
    index("student_guardians_guardian_idx").on(t.guardianId),
  ],
);

export const studentRelationshipTypeEnum = pgEnum("student_relationship_type", [
  "sibling",
  "twin",
  "step_sibling",
]);

/**
 * Sibling links between students in the same org. Drives sibling fee
 * concessions, which are a common Indian school policy, and lets the office
 * see a whole family at once.
 */
export const studentRelationships = pgTable(
  "student_relationships",
  {
    id: uuid().primaryKey().defaultRandom(),

    studentId: uuid()
      .notNull()
      .references(() => students.id),
    relatedStudentId: uuid()
      .notNull()
      .references(() => students.id),

    relationshipType: studentRelationshipTypeEnum().notNull().default("sibling"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("student_relationships_uq").on(t.studentId, t.relatedStudentId),
    index("student_relationships_student_idx").on(t.studentId),
  ],
);

/**
 * Where a student came from — the transfer certificate they arrived with.
 * Kept for admission audits and board verification, which can happen years
 * later.
 */
export const previousSchoolRecords = pgTable(
  "previous_school_records",
  {
    id: uuid().primaryKey().defaultRandom(),

    studentId: uuid()
      .notNull()
      .references(() => students.id),

    schoolName: varchar({ length: 255 }).notNull(),
    board: varchar({ length: 100 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),

    lastClassAttended: varchar({ length: 50 }),
    yearOfPassing: varchar({ length: 20 }),
    percentageOrGrade: varchar({ length: 20 }),

    tcNumber: varchar({ length: 100 }),
    tcDate: date(),
    tcDocumentUrl: text(),

    remarks: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("previous_school_records_student_idx").on(t.studentId)],
);

/**
 * Which login may act as which student. The student track of the two
 * authorization mechanisms (ADR-005, ADR-008).
 *
 * Many-to-many on purpose: a parent with three children has ONE login that
 * reaches all three, and switches between them in the portal. There are no
 * role_assignments rows for these users, and can() is never called for them —
 * access is ownership, filtered by the studentIds listed here.
 */
export const studentPortalAccess = pgTable(
  "student_portal_access",
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: text()
      .notNull()
      .references(() => user.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),

    // Which guardian this login belongs to, when it is a parent's. Null when
    // the student holds the account themselves.
    guardianId: uuid().references(() => guardians.id),

    // Shown first after login. A convenience only — never a security boundary;
    // the authoritative check is that the requested studentId appears in this
    // table for this user.
    isDefault: boolean().notNull().default(false),

    // Revocation is a flag, not a delete (hard rule 2). Custody disputes need
    // a record that access existed and when it stopped.
    isActive: boolean().notNull().default(true),
    revokedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_portal_access_uq").on(t.userId, t.studentId),
    index("student_portal_access_user_idx").on(t.userId),
    index("student_portal_access_student_idx").on(t.studentId),
  ],
);

export const staffRelations = relations(staff, ({ one }) => ({
  organization: one(organizations, {
    fields: [staff.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [staff.schoolId],
    references: [schools.id],
  }),
  user: one(user, {
    fields: [staff.userId],
    references: [user.id],
  }),
}));

export const studentRelations = relations(students, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [students.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [students.schoolId],
    references: [schools.id],
  }),
  guardians: many(studentGuardians),
  portalAccess: many(studentPortalAccess),
  previousSchools: many(previousSchoolRecords),
}));

export const guardianRelations = relations(guardians, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [guardians.organizationId],
    references: [organizations.id],
  }),
  students: many(studentGuardians),
}));

export const studentGuardianRelations = relations(
  studentGuardians,
  ({ one }) => ({
    student: one(students, {
      fields: [studentGuardians.studentId],
      references: [students.id],
    }),
    guardian: one(guardians, {
      fields: [studentGuardians.guardianId],
      references: [guardians.id],
    }),
  }),
);

export const studentPortalAccessRelations = relations(
  studentPortalAccess,
  ({ one }) => ({
    user: one(user, {
      fields: [studentPortalAccess.userId],
      references: [user.id],
    }),
    student: one(students, {
      fields: [studentPortalAccess.studentId],
      references: [students.id],
    }),
  }),
);

export const previousSchoolRecordRelations = relations(
  previousSchoolRecords,
  ({ one }) => ({
    student: one(students, {
      fields: [previousSchoolRecords.studentId],
      references: [students.id],
    }),
  }),
);
