// ============================================================================
// schema.app.ts — domain tables (stub). Replace with your real schema.
//
// Key authz contract: when your domain routes CREATE a school, class, or
// section, they MUST also insert a row into scope_nodes. The authz system
// reads scope_nodes to resolve the ancestry for every authorization check.
// See the insertScopeNode() helper at the bottom of this file.
// ============================================================================

import { pgTable, uuid, varchar, integer, date, json } from 'drizzle-orm/pg-core';
import { db } from './client';
import { scopeNodes } from './schema';
import { getRedis } from './redis';
import type { ScopeType } from '../types/hierarchy';

export const schools = pgTable('schools', {
  id:     uuid('id').primaryKey().defaultRandom(),
  orgId:  uuid('org_id').notNull(),
  name:   varchar('name', { length: 255 }).notNull(),
});

export const classes = pgTable('classes', {
  id:       uuid('id').primaryKey().defaultRandom(),
  orgId:    uuid('org_id').notNull(),
  schoolId: uuid('school_id').notNull(),
  name:     varchar('name', { length: 64 }).notNull(), // "Class 3", "Grade 8"
});

export const sections = pgTable('sections', {
  id:       uuid('id').primaryKey().defaultRandom(),
  orgId:    uuid('org_id').notNull(),
  schoolId: uuid('school_id').notNull(),
  classId:  uuid('class_id').notNull(),
  name:     varchar('name', { length: 32 }).notNull(), // "A", "B", "C"
});

export const attendance = pgTable('attendance', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull(),
  schoolId:  uuid('school_id').notNull(),
  classId:   uuid('class_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  date:      varchar('date', { length: 10 }).notNull(),
  records:   json('records'), // { studentId: 'present'|'absent'|'late' }[]
});

export const marks = pgTable('marks', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull(),
  schoolId:  uuid('school_id').notNull(),
  classId:   uuid('class_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  examType:  varchar('exam_type', { length: 64 }),
  records:   json('records'),
  published: varchar('published', { length: 1 }).default('N').notNull(),
});

// Fee domain tables
export const feeHeads = pgTable('fee_heads', {
  id:       uuid('id').primaryKey().defaultRandom(),
  orgId:    uuid('org_id').notNull(),
  schoolId: uuid('school_id').notNull(),
  name:     varchar('name', { length: 128 }).notNull(), // "Tuition", "Library Fee"
  amount:   integer('amount').notNull(),
});

export const feePayments = pgTable('fee_payments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull(),
  schoolId:    uuid('school_id').notNull(),
  studentId:   uuid('student_id').notNull(),
  feeHeadId:   uuid('fee_head_id').notNull(),
  amountPaid:  integer('amount_paid').notNull(),
  paidAt:      date('paid_at'),
  status:      varchar('status', { length: 32 }).default('pending').notNull(),
});

// The subject check table — filled by the admin when assigning teachers to subjects.
// Only marks and homework routes check this. Authz scope says "can this teacher
// touch this section at all?" — this table says "which subjects specifically?"
export const staffSubjectAssignments = pgTable('staff_subject_assignments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull(),
  schoolId:     uuid('school_id').notNull(),
  classId:      uuid('class_id').notNull(),
  sectionId:    uuid('section_id').notNull(),
  staffUserId:  uuid('staff_user_id').notNull(),
  subjectId:    uuid('subject_id').notNull(),
  academicYear: varchar('academic_year', { length: 10 }).notNull(), // "2025-26"
});

// ============================================================================
// insertScopeNode — MUST be called by domain routes when creating a school,
// class, or section. The authz system depends on this table being up to date.
// ============================================================================
export async function insertScopeNode(params: {
  id:       string;
  type:     Exclude<ScopeType, 'org'>;
  orgId:    string;
  schoolId: string | null;
  classId:  string | null;
}): Promise<void> {
  await db.insert(scopeNodes).values(params).onConflictDoNothing();
  // Invalidate the scope node cache for this id
  await getRedis().del(`scope_node:${params.id}`);
}
