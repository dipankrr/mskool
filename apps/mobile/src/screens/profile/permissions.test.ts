import { displayAction, displayResource, groupPermissions } from "./permissions";

describe("displayResource", () => {
  it("sentence-cases snake tokens", () => {
    expect(displayResource("academic_year")).toBe("Academic year");
    expect(displayResource("fee_payment")).toBe("Fee payment");
    expect(displayResource("attendance")).toBe("Attendance");
  });

  it("keeps ID an acronym", () => {
    expect(displayResource("id_card")).toBe("ID card");
  });
});

describe("displayAction", () => {
  it("keeps actions lowercase and expands underscores", () => {
    expect(displayAction("read")).toBe("read");
    expect(displayAction("read_history")).toBe("read history");
    expect(displayAction("reset_password")).toBe("reset password");
  });
});

describe("groupPermissions", () => {
  it("groups actions under their resource and sorts both", () => {
    expect(
      groupPermissions([
        "fee_payment:read",
        "attendance:update",
        "attendance:create",
        "academic_year:read_history",
      ]),
    ).toEqual([
      {
        resource: "academic_year",
        label: "Academic year",
        actions: [{ key: "read_history", label: "read history" }],
      },
      {
        resource: "attendance",
        label: "Attendance",
        actions: [
          { key: "create", label: "create" },
          { key: "update", label: "update" },
        ],
      },
      {
        resource: "fee_payment",
        label: "Fee payment",
        actions: [{ key: "read", label: "read" }],
      },
    ]);
  });

  it("dedupes repeated grants", () => {
    expect(groupPermissions(["attendance:read", "attendance:read"])).toEqual([
      {
        resource: "attendance",
        label: "Attendance",
        actions: [{ key: "read", label: "read" }],
      },
    ]);
  });

  it("keeps a bare unrecognised permission instead of dropping it", () => {
    expect(groupPermissions(["legacy_grant"])).toEqual([
      { resource: "legacy_grant", label: "Legacy grant", actions: [] },
    ]);
  });

  it("tolerates the dot separator used in older notes", () => {
    expect(groupPermissions(["fee.list"])).toEqual([
      {
        resource: "fee",
        label: "Fee",
        actions: [{ key: "list", label: "list" }],
      },
    ]);
  });

  it("ignores blank entries and surrounding whitespace", () => {
    expect(groupPermissions(["", "  ", " attendance:read "])).toEqual([
      {
        resource: "attendance",
        label: "Attendance",
        actions: [{ key: "read", label: "read" }],
      },
    ]);
  });

  it("returns no groups for no permissions", () => {
    expect(groupPermissions([])).toEqual([]);
  });
});
