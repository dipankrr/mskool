import { z } from "zod";
import { organizationSelectSchema, schoolSelectSchema } from "./organization.contract";

/**
 * The bootstrap payload for a signed-in staff user.
 *
 * Every staff procedure requires `organizationId` in its input (see
 * staffProcedure in @repo/trpc), but a better-auth session carries only the
 * user — no org, no role, no scope. Without this endpoint the client has no
 * legitimate way to learn which org to name, and the whole staff API is
 * unreachable from the browser. This is that missing first call.
 *
 * Not derived from a single table via drizzle-zod, because it is not a table:
 * it is assembled from `role_assignments`, `org_role_permissions` and
 * `scope_nodes` by way of the cached auth snapshot.
 */

/**
 * One org this user holds a role in, with the schools they may see inside it.
 *
 * `permissions` is the union across every non-expired assignment in that org —
 * what the UI should use to decide whether to render an action, never to
 * authorize one. Authorization stays server-side in can(); this list is a hint
 * for the view, and a client that tampers with it gains nothing.
 */
export const membershipSchema = z.object({
  organization: organizationSelectSchema,
  /**
   * Scope levels held in this org, coarsest first. A user scoped to one branch
   * has ["school"]; a trust admin has ["org"]. The switcher uses this to decide
   * whether to offer an "all schools" option at all.
   */
  scopeTypes: z.array(z.enum(["org", "school", "class", "section"])),
  roleTypes: z.array(z.string()),
  permissions: z.array(z.string()),
  /** Active schools visible under this user's grants in this org. */
  schools: z.array(schoolSelectSchema),
});
export type Membership = z.infer<typeof membershipSchema>;

export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    // Nullable ahead of ADR-007: students authenticate by phone and will have
    // no email. Staff always do.
    email: z.string().nullable(),
    image: z.string().nullable(),
    isSuperAdmin: z.boolean(),
  }),
  /**
   * Empty for a valid session with no staff role — a student, or a user whose
   * roles were all revoked. The client must treat [] as "no staff access"
   * rather than as an error, since the session itself is fine.
   */
  memberships: z.array(membershipSchema),
});
export type Me = z.infer<typeof meSchema>;
