import {
  DEFAULT_ROLE_PERMISSIONS,
  insertScopeNode,
  ROLE_TYPES,
  scopeWhere,
  type DataScope,
  type ScopeColumns,
} from "@repo/authz";
import type {
  CreateOrganizationInput,
  CreateSchoolInput,
  UpdateSchoolInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import { orgRolePermissions, schools } from "@repo/db/schema";
import { organizations } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * How `schools` expresses each scope level.
 *
 * The school level maps to the table's OWN primary key — a school IS its id;
 * there is no `schools.schoolId`. The previous scopeWhere() guessed columns by
 * name, found none called `schoolId`, and silently dropped the restriction, so
 * a principal scoped to one branch listed every school in the trust. Mapping
 * it explicitly is what makes that class of bug impossible.
 *
 * Nothing is mapped for class or section: a scope narrowed to those levels
 * cannot be expressed against this table, and scopeWhere() will throw rather
 * than return a wider result than the caller is entitled to.
 */
const SCHOOL_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: schools.organizationId,
  schoolId: schools.id,
};

/**
 * Organizations and their schools.
 *
 * Services know nothing about HTTP. They take a DataScope as a REQUIRED
 * argument and filter every query by it (hard rule 1) — that requirement is
 * what makes a forgotten tenancy filter a compile error instead of a leak.
 */
export class OrganizationService {
  /**
   * Provisions a tenant: the org row plus its default permission matrix, in one
   * transaction. Without the matrix, the org's first admin would have a role
   * that grants nothing and could not even open their own settings.
   *
   * No DataScope argument — this creates the tenant, so it runs above tenancy
   * and belongs to platform-level (super-admin) callers only.
   */
  async createOrganization(input: CreateOrganizationInput) {
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values(input)
        .returning();

      if (!organization) {
        throw new Error("Failed to create organization.");
      }

      // Copy the defaults in. They are the org's own rows from here on, and
      // editing this file later will not touch them (ADR-011).
      const rows = ROLE_TYPES.flatMap((roleType) =>
        DEFAULT_ROLE_PERMISSIONS[roleType].map((permission) => ({
          organizationId: organization.id,
          roleType,
          permission,
        })),
      );

      await tx.insert(orgRolePermissions).values(rows);

      return organization;
    });
  }

  async getOrganizationById(organizationId: string) {
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    return organization ?? null;
  }

  /**
   * Creates a school AND its scope node in ONE transaction — hard rule 12.
   *
   * These cannot be split. A committed school with no scope node is invisible
   * to authorization: loadScopeNode returns null, and every request against it
   * 403s, including from the admin who created it. The failure presents as a
   * permissions bug and is painful to trace back to a missing row, so the two
   * writes stay welded together here.
   */
  async createSchool(organizationId: string, input: CreateSchoolInput) {
    return db.transaction(async (tx) => {
      const [school] = await tx
        .insert(schools)
        // organizationId comes from the caller's authenticated scope, never
        // from client input.
        .values({ ...input, organizationId })
        .returning();

      if (!school) {
        throw new Error("Failed to create school.");
      }

      // Same transaction. Do not move this out.
      // schoolId stays null: for a school node, its own id IS the schoolId.
      await insertScopeNode(tx, {
        id: school.id,
        type: "school",
        organizationId,
      });

      return school;
    });
  }

  /**
   * Lists the schools the caller may see.
   *
   * Takes the PLURAL scopes: a user may hold grants in several branches, and
   * no single DataScope can express "school A or school B".
   */
  async listSchools(scopes: DataScope[]) {
    return db
      .select()
      .from(schools)
      .where(
        and(
          scopeWhere(scopes, SCHOOL_SCOPE_COLUMNS),
          eq(schools.isActive, true),
        ),
      );
  }

  /**
   * Reads one school, still filtered by scope. Fetching by id alone would let
   * a principal at one branch read another branch by guessing an id.
   */
  async getSchoolById(scope: DataScope, schoolId: string) {
    const [school] = await db
      .select()
      .from(schools)
      .where(
        and(
          eq(schools.id, schoolId),
          scopeWhere(scope, SCHOOL_SCOPE_COLUMNS),
        ),
      );

    return school ?? null;
  }

  async updateSchool(
    scope: DataScope,
    schoolId: string,
    input: UpdateSchoolInput,
  ) {
    const [school] = await db
      .update(schools)
      .set(input)
      .where(
        and(
          eq(schools.id, schoolId),
          scopeWhere(scope, SCHOOL_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return school ?? null;
  }

  /**
   * Deactivates a school. Never a DELETE (hard rule 2) — its students, fee
   * history, and results must stay reachable after it closes.
   */
  async deactivateSchool(scope: DataScope, schoolId: string) {
    const [school] = await db
      .update(schools)
      .set({ isActive: false })
      .where(
        and(
          eq(schools.id, schoolId),
          scopeWhere(scope, SCHOOL_SCOPE_COLUMNS),
        ),
      )
      .returning();


    return school ?? null;
  }
}

export const organizationService = new OrganizationService();
