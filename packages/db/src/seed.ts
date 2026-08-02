// import { db } from "./client";
// import { user } from "./schema/auth";
// import { organizations, defaultRolePermissions, roleAssignments } from "./schema/authz";
// import { schools, centers, exams, examCycles } from "./schema/academics";
// import { randomUUID } from "crypto";

// /**
//  * Default role permissions seeded at platform level (copied into
//  * org_role_permissions when an org is provisioned via
//  * organization.service.provisionOrganization).
//  *
//  * These are deliberately conservative starting defaults — org_admin can
//  * expand any role's permissions via the role-permissions UI/API.
//  */
// const DEFAULT_PERMISSIONS: Array<{ role: string; permission: string }> = [
//   // org_admin gets everything
//   { role: "org_admin", permission: "exam:create" },
//   { role: "org_admin", permission: "exam:read" },
//   { role: "org_admin", permission: "exam:update" },
//   { role: "org_admin", permission: "exam:publish" },
//   { role: "org_admin", permission: "student_registration:create" },
//   { role: "org_admin", permission: "student_registration:read" },
//   { role: "org_admin", permission: "student_registration:update" },
//   { role: "org_admin", permission: "student_registration:assign" },
//   { role: "org_admin", permission: "marks:create" },
//   { role: "org_admin", permission: "marks:read" },
//   { role: "org_admin", permission: "result:publish" },
//   { role: "org_admin", permission: "result:read" },
//   { role: "org_admin", permission: "role_assignment:create" },
//   { role: "org_admin", permission: "role_assignment:revoke" },
//   { role: "org_admin", permission: "role_permission:update" },
//   { role: "org_admin", permission: "user:read" },
//   // district_incharge
//   { role: "district_incharge", permission: "exam:read" },
//   { role: "district_incharge", permission: "student_registration:read" },
//   { role: "district_incharge", permission: "student_registration:update" },
//   { role: "district_incharge", permission: "student_registration:assign" },
//   { role: "district_incharge", permission: "marks:read" },
//   { role: "district_incharge", permission: "result:read" },
//   { role: "district_incharge", permission: "role_assignment:create" },
//   { role: "district_incharge", permission: "role_assignment:revoke" },
//   // school_incharge
//   { role: "school_incharge", permission: "exam:read" },
//   { role: "school_incharge", permission: "student_registration:create" },
//   { role: "school_incharge", permission: "student_registration:read" },
//   { role: "school_incharge", permission: "result:read" },
//   // center_incharge
//   { role: "center_incharge", permission: "exam:read" },
//   { role: "center_incharge", permission: "student_registration:read" },
//   { role: "center_incharge", permission: "marks:create" },
//   { role: "center_incharge", permission: "marks:read" },
//   { role: "center_incharge", permission: "result:read" },
//   { role: "center_incharge", permission: "role_assignment:create" },
//   { role: "center_incharge", permission: "role_assignment:revoke" },
//   // marks_entry_operator — enter-only, no read (org can grant read via UI)
//   { role: "marks_entry_operator", permission: "marks:create" },
//   // student_entry_operator
//   { role: "student_entry_operator", permission: "student_registration:create" },
//   { role: "student_entry_operator", permission: "student_registration:read" },
// ];

// async function main() {
//   console.log("Seeding default_role_permissions...");
//   await db
//     .insert(defaultRolePermissions)
//     .values(DEFAULT_PERMISSIONS)
//     .onConflictDoNothing();

//   console.log("Seeding demo org + users...");

//   const [org] = await db
//     .insert(organizations)
//     .values({ name: "Bharat Talent Search Council", slug: "bharat-talent-search" })
//     .returning();

//   const superAdminId = randomUUID();
//   await db.insert(user).values({
//     id: superAdminId,
//     name: "Platform Super Admin",
//     email: "superadmin@example.com",
//     isSuperAdmin: true,
//   });

//   const orgAdminId = randomUUID();
//   await db.insert(user).values({
//     id: orgAdminId,
//     name: "BTSC Org Admin",
//     email: "orgadmin@btsc.example.com",
//   });
//   // org_admin assignment — no scope columns set = org-wide access
//   await db.insert(roleAssignments).values({
//     id: randomUUID(),
//     userId: orgAdminId,
//     role: "org_admin",
//     orgId: org!.id,
//     grantedBy: superAdminId,
//   });

//   const [school] = await db
//     .insert(schools)
//     .values({
//       organizationId: org!.id,
//       name: "Greenfield Public School",
//       district: "Kolkata",
//       state: "West Bengal",
//     })
//     .returning();

//   const inchargeId = randomUUID();
//   await db.insert(user).values({
//     id: inchargeId,
//     name: "Greenfield School Incharge",
//     email: "incharge@greenfield.example.com",
//   });
//   // school_incharge — scoped to this one school
//   await db.insert(roleAssignments).values({
//     id: randomUUID(),
//     userId: inchargeId,
//     role: "school_incharge",
//     orgId: org!.id,
//     schoolId: school!.id,
//     grantedBy: orgAdminId,
//   });

//   const [center] = await db
//     .insert(centers)
//     .values({
//       organizationId: org!.id,
//       name: "District Exam Center, Kolkata",
//       district: "Kolkata",
//       state: "West Bengal",
//       capacity: 200,
//     })
//     .returning();

//   const [exam] = await db
//     .insert(exams)
//     .values({
//       organizationId: org!.id,
//       name: "BTSC Junior Talent Search Examination",
//       slug: "btsc-jtse",
//       description: "Annual merit exam for classes 6-8 across West Bengal.",
//     })
//     .returning();

//   const [cycle] = await db
//     .insert(examCycles)
//     .values({
//       examId: exam!.id,
//       year: 2026,
//       status: "registration_open",
//       registrationStartsAt: new Date(),
//       registrationEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
//     })
//     .returning();

//   console.log("✅ Seed complete.\n");
//   console.log({
//     orgId: org!.id,
//     superAdminId,
//     orgAdminId,
//     inchargeId,
//     schoolId: school!.id,
//     centerId: center!.id,
//     examId: exam!.id,
//     examCycleId: cycle!.id,
//   });

//   process.exit(0);
// }

// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
