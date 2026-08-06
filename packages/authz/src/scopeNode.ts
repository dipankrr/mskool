import { scopeNodes } from "@repo/db/schema";
import type { ScopeType } from "./roles";

/**
 * Inserts the scope_nodes row for a school, class, or section.
 *
 * HARD RULE 12: this MUST run inside the same transaction that creates the
 * entity. A school without its node is invisible to authorization — every
 * request touching it 403s, including from the admin who just created it, and
 * the failure looks like a permissions bug rather than a missing row.
 *
 * `tx` is the transaction handle, not the db client, so the call cannot
 * accidentally commit independently:
 *
 *   await db.transaction(async (tx) => {
 *     const [school] = await tx.insert(schools).values(input).returning();
 *     await insertScopeNode(tx, {
 *       id: school.id, type: "school", organizationId: school.organizationId,
 *     });
 *   });
 *
 * The node id IS the entity id — that equality is what lets a request resolve
 * a node directly from an input parameter, with no extra lookup.
 */
export async function insertScopeNode(
  tx: {
    insert: (table: typeof scopeNodes) => {
      values: (v: {
        id: string;
        type: ScopeType;
        organizationId: string;
        schoolId?: string | null;
        classId?: string | null;
      }) => Promise<unknown>;
    };
  },
  node: {
    id: string;
    type: ScopeType;
    organizationId: string;
    /** Required for class and section nodes. Null for a school node — its own id is the schoolId. */
    schoolId?: string | null;
    /** Required for section nodes only. */
    classId?: string | null;
  },
): Promise<void> {
  await tx.insert(scopeNodes).values({
    id: node.id,
    type: node.type,
    organizationId: node.organizationId,
    schoolId: node.schoolId ?? null,
    classId: node.classId ?? null,
  });
}
