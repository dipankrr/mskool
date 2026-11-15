import {
  createStaffLoginInput,
  createStaffSchema,
  deactivateStaffSchema,
  moveStaffSchema,
  resetStaffLoginInput,
  setStaffLeaveSchema,
  staffExportSchema,
  imageRefSchema,
  staffFormHintsSchema,
  staffInviteSchema,
  staffPhoneCheckSchema,
  staffSelectSchema,
  staffListItemSchema,
  staffWithPhotoSchema,
  updateStaffSchema,
  uploadRequestSchema,
  uploadTicketSchema,
} from "@repo/contracts";
import { can } from "@repo/authz";
import {
  assignmentService,
  roleService,
  staffLoginService,
  staffPhotoService,
  staffService,
} from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * STAFF — the employment register and its login provisioning (ADR-008,
 * ADR-035).
 *
 * The register is CRUD in the students-slice shape; the login endpoints are
 * the one credential-shaped concern, and their gates are deliberately
 * `staff:update` — provisioning a login is an act on the EMPLOYMENT record
 * (an org hands its own staff a credential; it is not an authorization
 * change, which is `role_assignment`'s job and carries its own SENSITIVE
 * permissions). Every login act writes an audit row (ADR-035), and the
 * service owns `must_change_password` — never the client.
 *
 * NOT in the scope tree — no `scope_nodes` writes. `resolveStaffOwner` reads
 * the owning branch from the row; a cross-tenant id and a nonexistent one
 * are the same NOT_FOUND. No delete: hard rule 2, the register's soft
 * delete is `deactivate` with an honest leaving status.
 */
const resolveStaffOwner = async (organizationId: string, id: string) => {
  const schoolId = await staffService.getStaffOwnerId(organizationId, id);

  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
  }

  return { type: "school", id: schoolId };
};

export const staffRouter = router({
  // Permissive list (ADR-017): an HR coordinator does not COVER the org node
  // she addresses to search the register. Active only unless the caller asks
  // for history explicitly.
  list: staffListProcedure("staff:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/staff",
        tags: ["staff"],
        summary: "Search the branch's staff register",
        protect: true,
      },
    })
    .input(
      z.object({
        q: z.string().min(1).max(100).optional(),
        includeInactive: z.boolean().optional(),
      }),
    )
    .output(z.array(staffListItemSchema))
    .query(async ({ ctx, input }) => {
      const rows = await staffService.listStaff(ctx.scopes, input.q, input.includeInactive);
      const ids = rows.map((row) => row.id);
      const [photos, states, teaching] = await Promise.all([
        staffPhotoService.many(input.organizationId, ids),
        staffLoginService.joinStates(ids),
        assignmentService.teachingByStaff(ctx.scopes, ids),
      ]);
      return rows.map((row) => ({
        ...row,
        photo: photos.get(row.id) ?? null,
        joinState: states.get(row.id) ?? "not_invited",
        teaching: teaching.get(row.id) ?? { classTeacherOf: null, subjects: [] },
      }));
    }),

  byId: staffProcedure("staff:read", {
    resolveOwner: resolveStaffOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/staff/{id}",
        tags: ["staff"],
        summary: "Get one staff member",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(staffWithPhotoSchema)
    .query(async ({ ctx, input }) => {
      const row = await staffService.getStaffById(ctx.scope, input.id);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      const [photo, states] = await Promise.all([
        staffPhotoService.get(ctx.scope.organizationId, row.id),
        staffLoginService.joinStates([row.id]),
      ]);
      return { ...row, photo, joinState: states.get(row.id) ?? "not_invited" };
    }),

  create: staffProcedure("staff:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/staff",
        tags: ["staff"],
        summary: "Add a staff member to the register",
        protect: true,
      },
    })
    // B5: the parent (the primary posting) is named in the endpoint's own
    // input. The service re-checks: REST callers are not type-checked
    // against this router.
    .input(z.object({ schoolId: z.uuid(), data: createStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — staff are not in the authorization tree. A
      // duplicate employee code is refused by the unique index and worded
      // by translateErrors (ADR-022). No login is created — ADR-035 keeps
      // the credential a separate, audited act.
      return staffService.createStaff(ctx.scope, input.data);
    }),

  update: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/staff/{id}",
        tags: ["staff"],
        summary: "Update a staff member's details",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.updateStaff(ctx.scope, input.id, input.data, ctx.userId);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * The register's soft delete (hard rule 2): the status records WHY the
   * employment ends, and the service stamps `dateOfLeaving` for departures.
   * Role assignments are NOT touched here — revoking them is an explicit,
   * audited act (the UI warns; ADR-035 defers deprovisioning automation).
   */
  deactivate: staffProcedure("staff:delete", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/deactivate",
        tags: ["staff"],
        summary: "Deactivate a staff member (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: deactivateStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.deactivateStaff(ctx.scope, input.id, input.data, ctx.userId);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * The way back from a deactivation (M7): suspension ends, a resignation
   * is withdrawn, a mistake is undone. Gated `staff:delete` like the
   * deactivation it reverses. Assignments and sessions are deliberately
   * untouched (ADR-035 defers deprovisioning automation) — the login card
   * says so where the credential lives.
   */
  reactivate: staffProcedure("staff:delete", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/reactivate",
        tags: ["staff"],
        summary: "Reactivate a staff member",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.reactivateStaff(ctx.scope, input.id, ctx.userId);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * On leave and back (2026-11-15). Leave keeps the sign-in, classes and
   * roles; the office covers the classes in Teaching.
   */
  setLeave: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/leave",
        tags: ["staff"],
        summary: "Put a staff member on leave, or mark them back",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: setStaffLeaveSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.setLeave(ctx.scope, input.id, input.data);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }
      return row;
    }),

  /**
   * Move to another branch. The gate covers the branch they work at now;
   * the caller must also hold staff:update at the branch they move to.
   */
  move: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/move",
        tags: ["staff"],
        summary: "Move a staff member to another branch",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: moveStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // A branch node: its id IS the school id (ADR-019).
      const allowed = can(ctx.authCache, "staff:update", {
        organizationId: ctx.organizationId,
        nodeId: input.data.toSchoolId,
        node: {
          id: input.data.toSchoolId,
          type: "school",
          organizationId: ctx.organizationId,
          schoolId: null,
          classId: null,
        },
      });
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can't add staff to that branch.",
        });
      }
      const row = await staffService.moveStaff(
        ctx.organizationId,
        input.id,
        input.data.toSchoolId,
        ctx.userId,
      );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }
      return row;
    }),

  /**
   * The branch's staff as a spreadsheet (CSV), for `staff:export` holders.
   * Personal details and people who left only when asked for.
   */
  export: staffListProcedure("staff:export")
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/export",
        tags: ["staff"],
        summary: "Export the branch's staff as CSV",
        protect: true,
      },
    })
    .input(staffExportSchema)
    .output(z.object({ fileName: z.string(), csv: z.string(), count: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await staffService.listStaff(ctx.scopes, undefined, input.includeLeft);
      const ids = rows.map((row) => row.id);
      const teaching = input.teaching ? await assignmentService.teachingByStaff(ctx.scopes, ids) : null;
      const roles = input.roles
        ? new Map(
            await Promise.all(
              ids.map(async (id) => [id, await roleService.forStaff(ctx.organizationId, id)] as const),
            ),
          )
        : null;

      const label = (c: string, s: string) => `${c.replace(/^class\s+/i, "")}-${s}`;
      const header = ["Name", "Employee code", "Job title", "Phone", "Status"];
      if (teaching) header.push("Class teacher of", "Teaches");
      if (roles) header.push("Roles");
      if (input.personal) header.push("Email", "Date of birth", "Date of joining", "Address");
      const lines = [header];
      for (const row of rows) {
        const line = [
          [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
          row.employeeCode,
          row.designation ?? "",
          row.phone ?? "",
          row.status.replace("_", " "),
        ];
        if (teaching) {
          const t = teaching.get(row.id);
          line.push(
            t?.classTeacherOf ? label(t.classTeacherOf.className, t.classTeacherOf.sectionName) : "",
            (t?.subjects ?? [])
              .map((x) => `${x.subjectName} ${x.sections.map((y) => label(y.className, y.sectionName)).join(" ")}`)
              .join("; "),
          );
        }
        if (roles) {
          line.push(
            (roles.get(row.id) ?? [])
              .map((r) => `${r.roleType.replace(/_/g, " ")} (${r.scopeLabel}${r.waiting ? ", waiting" : ""})`)
              .join("; "),
          );
        }
        if (input.personal) {
          line.push(
            row.email ?? "",
            row.dateOfBirth ?? "",
            row.dateOfJoining ?? "",
            [row.addressLine1, row.addressLine2, row.city, row.state, row.pincode].filter(Boolean).join(", "),
          );
        }
        lines.push(line);
      }
      const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const csv = lines.map((l) => l.map(cell).join(",")).join("\r\n");
      const today = new Date().toISOString().slice(0, 10);
      return { fileName: `staff-${today}.csv`, csv, count: rows.length };
    }),

  /**
   * ADR-035: first credential. The initial password is a hand-off secret;
   * the service forces a change at first sign-in and audits the issue.
   * Gated on `staff:update` — see the file comment for why it is not its
   * own permission.
   */
  createLogin: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/login",
        tags: ["staff"],
        summary: "Provision a staff login (initial password, forced change)",
        protect: true,
      },
    })
    .input(createStaffLoginInput.extend({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.createLogin(ctx.scope, ctx.userId, input.id, input.password);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * ADR-035: re-issue a credential. The forced-change flag returns and every
   * live session dies — the same takeover-closing discipline as the portal's
   * reset.
   */
  resetLogin: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/login/reset",
        tags: ["staff"],
        summary: "Reset a staff login (forced change, sessions revoked)",
        protect: true,
      },
    })
    .input(resetStaffLoginInput.extend({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.resetLogin(ctx.scope, ctx.userId, input.id, input.password);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  // ── The staff member's photo (ADR-068) ──────────────────────────────────
  // The office's side, gated on the record like the student photo. The
  // staff member's own side lives on `me` (me.photoUpload / me.setPhoto).

  /** A link to PUT this staff member's new photo to (ADR-063). */
  photoUpload: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid(), file: uploadRequestSchema }))
    .output(uploadTicketSchema)
    .mutation(({ ctx, input }) =>
      staffPhotoService.upload(ctx.scope.organizationId, input.id, input.file, ctx.userId),
    ),

  /** Makes an uploaded file this staff member's photo. */
  setPhoto: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid(), objectId: z.uuid() }))
    .output(z.object({ photo: imageRefSchema.nullable() }))
    .mutation(async ({ ctx, input }) => ({
      photo: await staffPhotoService.set(ctx.scope.organizationId, input.id, input.objectId, ctx.userId),
    })),

  removePhoto: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ removed: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      removed: await staffPhotoService.remove(ctx.scope.organizationId, input.id),
    })),

  // ── Sign-in (ADR-068) ────────────────────────────────────────────────────

  /**
   * A joining code for this staff member, shown once. Also the forgot-
   * password path: a new code lets someone who has joined set a new password.
   */
  invite: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid() }))
    .output(staffInviteSchema)
    .mutation(({ ctx, input }) =>
      staffLoginService.invite(ctx.scope.organizationId, input.id, ctx.userId),
    ),

  /** The add/edit form's live phone check: free, used here (named) or elsewhere. */
  checkPhone: staffProcedure("staff:read")
    .input(z.object({ phone: z.string().max(20), exceptId: z.uuid().optional() }))
    .output(staffPhoneCheckSchema)
    .query(({ ctx, input }) =>
      staffLoginService.checkPhone(ctx.scope.organizationId, input.phone, input.exceptId),
    ),

  /** Designation suggestions and the next employee code, for the add form. */
  formHints: staffProcedure("staff:read")
    .output(staffFormHintsSchema)
    .query(({ ctx }) => staffService.formHints(ctx.scope.organizationId)),
});
