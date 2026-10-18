import { initials } from "./avatar";

describe("initials", () => {
  it("takes first and last word initials", () => {
    expect(initials("Aditi Sharma")).toBe("AS");
    expect(initials("Ravi Kumar Verma")).toBe("RV");
  });

  it("takes the first two letters of a single word", () => {
    expect(initials("Rahul")).toBe("RA");
  });

  it("upper-cases whatever the roster stores", () => {
    expect(initials("aditi sharma")).toBe("AS");
  });

  it("never renders an empty chip", () => {
    expect(initials("   ")).toBe("?");
    expect(initials("")).toBe("?");
  });

  it("ignores extra whitespace", () => {
    expect(initials("  Aditi   Sharma  ")).toBe("AS");
  });
});
