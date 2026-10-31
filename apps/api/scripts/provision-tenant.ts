/**
 * Provision a new tenant — `pnpm db:provision -- --org-name "..." ...`.
 *
 * Creates what a school can't create for itself: the organization with its
 * permission matrix, the first school with its scope node (hard rule 12), and
 * the org admin's login, staff row and org-level grant. From there the admin
 * signs in, must change the password, and sets up the school in the app.
 *
 * No session is created: we'd have to know each school's dates, and the admin's
 * first session runs automatically (ADR-056).
 *
 * Refuses an existing slug or email rather than merging into them. It is not
 * idempotent by design: a re-run with the same details stops, and a run that
 * fails partway says what already exists.
 *
 * The default password is shared and known, so hand credentials over soon after
 * provisioning. Until first sign-in, anyone with the email can use it.
 */
import { parseArgs } from "node:util";

import { auth } from "@repo/auth";
import { createOrganizationSchema, createSchoolSchema } from "@repo/contracts";
import { db } from "@repo/db";
import { organizations, roleAssignments, staff, user } from "@repo/db/schema";
import { organizationService } from "@repo/services";
import { eq } from "drizzle-orm";

const DEFAULT_PASSWORD = "Password123!";

const USAGE = `
Usage: pnpm db:provision -- \\
  --org-name "Sunrise Education Trust" \\
  --org-slug sunrise-trust \\
  --school-name "Sunrise Public School" \\
  --school-code SPS-MAIN \\
  --admin-name "Asha Rao" \\
  --admin-email asha@sunrise.example \\
  [--board cbse] [--password "..."]
`;

function readOptions() {
  const { values } = parseArgs({
    options: {
      "org-name": { type: "string" },
      "org-slug": { type: "string" },
      "school-name": { type: "string" },
      "school-code": { type: "string" },
      "admin-name": { type: "string" },
      "admin-email": { type: "string" },
      board: { type: "string", default: "cbse" },
      password: { type: "string", default: DEFAULT_PASSWORD },
    },
    // pnpm forwards its own "--" separator.
    allowPositionals: true,
  });

  const required = [
    "org-name",
    "org-slug",
    "school-name",
    "school-code",
    "admin-name",
    "admin-email",
  ] as const;
  const missing = required.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Missing: ${missing.map((key) => `--${key}`).join(", ")}\n${USAGE}`);
  }

  return {
    orgName: values["org-name"]!,
    orgSlug: values["org-slug"]!,
    schoolName: values["school-name"]!,
    schoolCode: values["school-code"]!,
    adminName: values["admin-name"]!.trim(),
    adminEmail: values["admin-email"]!.trim().toLowerCase(),
    board: values.board!,
    password: values.password!,
  };
}

async function main() {
  const options = readOptions();

  // Validate everything before anything is written.
  const organizationInput = createOrganizationSchema.parse({
    name: options.orgName,
    legalName: options.orgName,
    slug: options.orgSlug,
  });
  const schoolInput = createSchoolSchema.parse({
    name: options.schoolName,
    legalName: options.schoolName,
    code: options.schoolCode,
    board: options.board,
  });

  const [existingOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, options.orgSlug));
  if (existingOrg) {
    throw new Error(`An organization with the slug "${options.orgSlug}" already exists.`);
  }
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, options.adminEmail));
  if (existingUser) {
    throw new Error(`A login with the email "${options.adminEmail}" already exists.`);
  }

  const organization = await organizationService.createOrganization(organizationInput);
  console.log(`  + organization ${options.orgSlug}`);

  const school = await organizationService.createSchool(organization.id, schoolInput);
  console.log(`  + school ${options.schoolCode}`);

  await auth.api.signUpEmail({
    body: { name: options.adminName, email: options.adminEmail, password: options.password },
  });
  const [admin] = await db
    .update(user)
    .set({ mustChangePassword: true })
    .where(eq(user.email, options.adminEmail))
    .returning();
  if (!admin) {
    throw new Error(`better-auth reported success but no user row exists for ${options.adminEmail}.`);
  }
  console.log(`  + login ${options.adminEmail}`);

  const [firstName, ...rest] = options.adminName.split(/\s+/);
  await db.insert(staff).values({
    organizationId: organization.id,
    // notNull, so even an org-level admin has a primary posting.
    schoolId: school.id,
    userId: admin.id,
    employeeCode: "ADMIN-001",
    firstName: firstName ?? options.adminName,
    lastName: rest.join(" ") || "-",
    designation: "Administrator",
  });
  console.log("  + staff ADMIN-001");

  // For scopeType 'org' the scopeId must equal the organization (ADR-019).
  await db.insert(roleAssignments).values({
    userId: admin.id,
    organizationId: organization.id,
    roleType: "org_admin",
    scopeType: "org",
    scopeId: organization.id,
    grantedBy: null,
  });
  console.log("  + grant org_admin @ org");

  console.log(`
Ready. Sign in to the app with:

  ${options.adminEmail}
  ${options.password === DEFAULT_PASSWORD ? `${DEFAULT_PASSWORD}  (the default)` : "the password you passed"}

The app asks for a new password at first sign-in, then helps set up the school.
`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
