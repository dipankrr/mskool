import {
  diffPermissions,
  editLock,
  givableRoles,
  groupCounts,
  orderedActions,
  permissionLabel,
  roleLabel,
  titleFromPicks,
} from "./role-logic";

describe("role logic", () => {
  it("fills the job title from the first office pick, skipping org admin", () => {
    expect(titleFromPicks(["accountant", "principal"])).toBe("Principal");
    expect(titleFromPicks(["org_admin"])).toBe("");
    expect(titleFromPicks([])).toBe("");
  });

  it("offers roles by permission: none without assign, org admin only org-wide", () => {
    expect(givableRoles({ canAssign: false, canAssignOrgWide: false })).toEqual([]);
    const branch = givableRoles({ canAssign: true, canAssignOrgWide: false }).map((r) => r.type);
    expect(branch).not.toContain("org_admin");
    expect(branch).toContain("principal");
    expect(givableRoles({ canAssign: true, canAssignOrgWide: true }).map((r) => r.type)).toContain("org_admin");
  });

  it("names roles and permissions in plain words", () => {
    expect(roleLabel("staff_coordinator")).toBe("Coordinator");
    expect(roleLabel("class_teacher")).toBe("Class teacher");
    expect(permissionLabel("fee_payment:approve")).toBe("Collecting fees: Approve");
    expect(permissionLabel("fee_payment:create")).toBe("Collecting fees: Collect");
    expect(permissionLabel("academic_year:read_history")).toBe("Sessions: Past sessions");
  });

  it("lists See first", () => {
    expect(orderedActions("fee_head", ["create", "read", "update"])).toEqual([
      "fee_head:read",
      "fee_head:create",
      "fee_head:update",
    ]);
  });

  it("diffs a draft against what the role has", () => {
    const now = new Set(["a:read", "a:create", "b:read"]);
    const draft = new Set(["a:read", "b:read", "b:update", "c:read"]);
    expect(diffPermissions(now, draft)).toEqual({ add: ["b:update", "c:read"], remove: ["a:create"], count: 3 });
  });

  it("counts held permissions per group", () => {
    const catalog = [{ category: "Finance", resources: [{ resource: "fee_head", actions: ["read", "create"] }] }];
    expect(groupCounts(catalog, new Set(["fee_head:read"]))).toEqual([{ category: "Finance", total: 2, held: 1 }]);
  });

  it("locks org admin for everyone and a role you hold yourself", () => {
    expect(editLock("org_admin", [])).toBe("org_admin");
    expect(editLock("principal", ["principal"])).toBe("self");
    expect(editLock("accountant", ["principal"])).toBeNull();
  });
});
