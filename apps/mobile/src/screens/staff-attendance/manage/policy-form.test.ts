import { copy } from "../../../lib/copy";
import {
  initialPolicyForm,
  toPolicyPayload,
  validatePolicyForm,
} from "./policy-form";
import type { PolicyForm } from "./policy-form";

function form(patch: Partial<PolicyForm> = {}): PolicyForm {
  return {
    mode: "period_wise",
    rule: "threshold_percentage",
    threshold: "80",
    late: "15",
    ...patch,
  };
}

describe("initialPolicyForm", () => {
  it("defaults to daily, homeroom decides, a 15-minute window", () => {
    expect(initialPolicyForm(null)).toEqual({
      mode: "daily",
      rule: "homeroom_authoritative",
      threshold: "",
      late: "15",
    });
  });

  it("maps a stored policy back to the form", () => {
    expect(
      initialPolicyForm({
        markingMode: "period_wise",
        dailyStatusRule: "threshold_percentage",
        thresholdPercentage: 80,
        lateArrivalMinutes: 20,
      }),
    ).toEqual({
      mode: "period_wise",
      rule: "threshold_percentage",
      threshold: "80",
      late: "20",
    });
  });
});

describe("validatePolicyForm", () => {
  it("requires a whole-number threshold between 1 and 100", () => {
    expect(validatePolicyForm(form({ threshold: "" })).threshold).toBe(
      copy.attendance.manage.policy.errors.threshold,
    );
    expect(validatePolicyForm(form({ threshold: "0" })).threshold).toBeTruthy();
    expect(
      validatePolicyForm(form({ threshold: "101" })).threshold,
    ).toBeTruthy();
    expect(
      validatePolicyForm(form({ threshold: "80.5" })).threshold,
    ).toBeTruthy();
    expect(
      validatePolicyForm(form({ threshold: "80" })).threshold,
    ).toBeUndefined();
  });

  it("does not police the threshold when homeroom decides", () => {
    expect(
      validatePolicyForm(
        form({ rule: "homeroom_authoritative", threshold: "" }),
      ).threshold,
    ).toBeUndefined();
  });

  it("requires whole minutes between 0 and 120", () => {
    expect(validatePolicyForm(form({ late: "" })).late).toBe(
      copy.attendance.manage.policy.errors.late,
    );
    expect(validatePolicyForm(form({ late: "121" })).late).toBeTruthy();
    expect(validatePolicyForm(form({ late: "0" })).late).toBeUndefined();
    expect(validatePolicyForm(form({ late: "120" })).late).toBeUndefined();
  });
});

describe("toPolicyPayload", () => {
  it("sends the threshold only when the rule reads it", () => {
    expect(toPolicyPayload(form())).toEqual({
      markingMode: "period_wise",
      dailyStatusRule: "threshold_percentage",
      thresholdPercentage: 80,
      lateArrivalMinutes: 15,
    });
    expect(
      toPolicyPayload(
        form({ rule: "homeroom_authoritative", threshold: "80" }),
      ),
    ).toEqual({
      markingMode: "period_wise",
      dailyStatusRule: "homeroom_authoritative",
      thresholdPercentage: null,
      lateArrivalMinutes: 15,
    });
  });
});
