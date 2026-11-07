jest.mock("../../env", () => ({ env: { EXPO_PUBLIC_API_URL: "http://api.test" } }));

import { dobToIso, formatPhone, isPhone, maskDob, phoneDigits } from "./sign-in";

describe("family sign-in helpers", () => {
  it("keeps the last 10 digits of a typed phone", () => {
    expect(phoneDigits("+91 98765-43210")).toBe("9876543210");
    expect(isPhone("98765 43210")).toBe(true);
    expect(isPhone("98765")).toBe(false);
    expect(formatPhone("9876543210")).toBe("98765 43210");
  });

  it("masks a date of birth as it is typed", () => {
    expect(maskDob("1")).toBe("1");
    expect(maskDob("150")).toBe("15 / 0");
    expect(maskDob("15032015")).toBe("15 / 03 / 2015");
    expect(maskDob("15/03/2015999")).toBe("15 / 03 / 2015");
  });

  it("reads a real past date only", () => {
    const today = new Date(2026, 10, 7);
    expect(dobToIso("15 / 03 / 2015", today)).toBe("2015-03-15");
    expect(dobToIso("29 / 02 / 2016", today)).toBe("2016-02-29");
    expect(dobToIso("29 / 02 / 2015", today)).toBeNull();
    expect(dobToIso("31 / 04 / 2015", today)).toBeNull();
    expect(dobToIso("01 / 13 / 2015", today)).toBeNull();
    expect(dobToIso("01 / 01 / 2030", today)).toBeNull();
    expect(dobToIso("15 / 03", today)).toBeNull();
  });
});
