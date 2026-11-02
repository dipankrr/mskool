import { describe, expect, it } from "vitest";
import { amountInWords } from "./amount-words";
import { dueLabel, esc, fileNameOf, longDate, rupees, type PrintIdentity } from "./html";
import { dayBookTotals } from "./counter";
import { renderNotices, upiLink } from "./notices";
import { renderReceipt, type ReceiptData } from "./receipt";

const identity: PrintIdentity = {
  schoolName: "Demo School",
  addressLine: "1 Road, Kolkata",
  contactLine: "",
  affiliationLine: "",
  headerLines: [],
  subLines: [],
  footerLines: [],
  signatureLabel: "Authorised signature",
  titles: {},
  showAmountInWords: true,
  logoDataUri: null,
};

const receipt: ReceiptData = {
  receiptNumber: "RCP-2604-00003",
  paymentDate: "2026-11-02",
  studentName: "Aditi Sharma",
  admissionNumber: "DEMO-0001",
  classLine: "Class 6 · A",
  lines: [{ label: "Tuition — April", amount: "1000.00" }],
  amount: "1000.00",
  lateFee: "50.00",
  discount: "0.00",
  total: "1050.00",
  modeLabel: "Cash",
  reference: null,
  bankName: null,
  chequeDate: null,
  remarks: null,
  status: "cleared",
  refunded: "0.00",
};

describe("amountInWords", () => {
  it.each([
    ["0.00", "Rupees Zero Only"],
    ["1.00", "Rupees One Only"],
    ["19.00", "Rupees Nineteen Only"],
    ["21.00", "Rupees Twenty One Only"],
    ["100.00", "Rupees One Hundred Only"],
    ["1050.00", "Rupees One Thousand Fifty Only"],
    ["105000.00", "Rupees One Lakh Five Thousand Only"],
    ["105000.50", "Rupees One Lakh Five Thousand and Fifty Paise Only"],
    ["1234567.05", "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Five Paise Only"],
    ["20000000.00", "Rupees Two Crore Only"],
  ])("%s", (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });
});

describe("formatting", () => {
  it("groups money the Indian way", () => {
    expect(rupees("999.00")).toBe("₹999.00");
    expect(rupees("1000.00")).toBe("₹1,000.00");
    expect(rupees("105000.5")).toBe("₹1,05,000.50");
    expect(rupees("12345678.00")).toBe("₹1,23,45,678.00");
    expect(rupees("-250.00")).toBe("-₹250.00");
  });

  it("prints readable dates", () => {
    expect(longDate("2026-11-02")).toBe("2 Nov 2026");
  });

  it("escapes everything HTML cares about", () => {
    expect(esc(`<script>"a"&'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;",
    );
  });

  it("makes a safe file name, keeping regional letters", () => {
    expect(fileNameOf("Receipt", "RCP/2604 00003")).toBe("Receipt-RCP-2604-00003.pdf");
    expect(fileNameOf("নোটিশ", "Class 6")).toBe("নোটিশ-Class-6.pdf");
  });
});

describe("renderReceipt", () => {
  it("prints the facts, the total and the amount in words", () => {
    const doc = renderReceipt(identity, receipt, "a4_full");
    expect(doc.html).toContain("RCP-2604-00003");
    expect(doc.html).toContain("Aditi Sharma");
    expect(doc.html).toContain("₹1,050.00");
    expect(doc.html).toContain("Late fee");
    expect(doc.html).toContain("Rupees One Thousand Fifty Only");
    expect(doc.fileName).toBe("Receipt-RCP-2604-00003.pdf");
    expect(doc.width).toBe(595);
  });

  it("keeps the number when words are turned off", () => {
    const doc = renderReceipt({ ...identity, showAmountInWords: false }, receipt, "a4_full");
    expect(doc.html).toContain("₹1,050.00");
    expect(doc.html).not.toContain("Rupees");
  });

  it("escapes what a school or a person typed", () => {
    const doc = renderReceipt(
      { ...identity, schoolName: "<img src=x onerror=alert(1)>", footerLines: ["<b>x</b>"] },
      { ...receipt, studentName: `"><script>alert(1)</script>`, remarks: "<i>y</i>" },
      "a4_full",
    );
    expect(doc.html).not.toContain("<script>");
    expect(doc.html).not.toContain("<img");
    expect(doc.html).not.toContain("<b>x");
    expect(doc.html).not.toContain("<i>y");
  });

  it.each([
    ["cancelled", "CANCELLED"],
    ["bounced", "BOUNCED"],
    ["reversed", "REFUNDED"],
  ])("stamps a %s receipt", (status, stamp) => {
    expect(renderReceipt(identity, { ...receipt, status }, "a4_full").html).toContain(
      `class="stamp">${stamp}`,
    );
  });

  it("doesn't stamp a good receipt, and says a partial refund in words", () => {
    const good = renderReceipt(identity, receipt, "a4_full").html;
    expect(good).not.toContain(`class="stamp"`);
    const partial = renderReceipt(identity, { ...receipt, refunded: "200.00" }, "a4_full").html;
    expect(partial).not.toContain(`class="stamp"`);
    expect(partial).toContain("Refunded: ₹200.00");
  });

  it("warns that a cheque isn't money yet", () => {
    const doc = renderReceipt(identity, { ...receipt, status: "pending" }, "a4_full");
    expect(doc.html).toContain("Subject to the money reaching the school.");
  });

  it("prints a discount below the total, not inside it", () => {
    const html = renderReceipt(identity, { ...receipt, discount: "100.00" }, "a4_full").html;
    expect(html.indexOf("Discount given: ₹100.00")).toBeGreaterThan(html.indexOf("Total"));
  });

  it("two copies are labelled, one parent and one office", () => {
    const html = renderReceipt(identity, receipt, "a4_half_two").html;
    expect(html).toContain("Parent copy");
    expect(html).toContain("Office copy");
  });

  it("leaves the top half empty when printing on the bottom half", () => {
    expect(renderReceipt(identity, receipt, "a4_half_bottom").html).toContain(`class="spacer"`);
  });

  it("moves a long receipt to a full page instead of cutting it off", () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ label: `Line ${i}`, amount: "10.00" }));
    const html = renderReceipt(identity, { ...receipt, lines }, "a4_half_two").html;
    expect(html).not.toContain(`class="half"`);
    expect(html).toContain("Line 11");
  });

  it("gives thermal paper its width, and grows with the lines", () => {
    const short = renderReceipt(identity, receipt, "thermal_58");
    expect(short.width).toBe(164);
    expect(renderReceipt(identity, receipt, "thermal_80").width).toBe(227);
    const lines = Array.from({ length: 12 }, (_, i) => ({ label: `Line ${i}`, amount: "10.00" }));
    const long = renderReceipt(identity, { ...receipt, lines }, "thermal_58");
    expect(long.height).toBeGreaterThan(short.height);
  });
});

describe("dueLabel", () => {
  it("names months the way people say them, and drops the old once suffix", () => {
    expect(dueLabel({ description: "Tuition Fee — 2026-11", feeHeadName: "Tuition" })).toBe(
      "Tuition Fee — November 2026",
    );
    expect(dueLabel({ description: "Admission — once", feeHeadName: "Admission" })).toBe("Admission");
    expect(dueLabel({ description: null, feeHeadName: "Dress" })).toBe("Dress");
  });
});

describe("due notices", () => {
  const owing = (name: string) => ({
    name,
    admissionNumber: `ADM-${name}`,
    className: "Class 6",
    sectionName: "A",
    rollNumber: null,
    dueNow: "7400.00",
    thisMonth: "1200.00",
    overdue: "6200.00",
    previousDues: "0.00",
    overdueMonths: 1,
  });

  it("puts the chosen number on each sheet, and breaks between sheets only", () => {
    const rows = ["A", "B", "C", "D", "E"].map(owing);
    const html = renderNotices(identity, {
      rows,
      perPage: 2,
      today: "2026-11-02",
      scopeLabel: "Class 6",
      qr: { kind: "none", schoolName: "Demo" },
    }).html;
    expect(html.match(/class="page per-2/g)).toHaveLength(3);
    expect(html.match(/ break"/g)).toHaveLength(2);
    expect(html.match(/class="notice"/g)).toHaveLength(5);
  });

  it("embeds a QR image once, however many notices", () => {
    const html = renderNotices(identity, {
      rows: Array.from({ length: 12 }, (_, i) => owing(`S${i}`)),
      perPage: 4,
      today: "2026-11-02",
      scopeLabel: "Class 6",
      qr: { kind: "image", schoolName: "Demo", imageDataUri: "data:image/png;base64,QUJD" },
    }).html;
    expect(html.split("QUJD")).toHaveLength(2);
  });

  it("builds a UPI link with the amount and admission number", () => {
    expect(upiLink({ upiId: "school@okaxis", payeeName: "Demo School", amount: "7400.00", note: "ADM-1" })).toBe(
      "upi://pay?pa=school%40okaxis&pn=Demo%20School&am=7400.00&cu=INR&tn=ADM-1",
    );
  });
});

describe("day book totals", () => {
  it("counts cleared and waiting money, not bounced or cancelled, and nets cash refunds", () => {
    const row = (modeLabel: string, total: string, status: string) => ({
      receiptNumber: "R",
      studentName: "S",
      classLine: null,
      modeLabel,
      reference: null,
      total,
      status,
    });
    const totals = dayBookTotals(
      [
        row("Cash", "1000.00", "cleared"),
        row("Cheque", "500.00", "pending"),
        row("Cheque", "300.00", "bounced"),
        row("Cash", "200.00", "cancelled"),
      ],
      [{ studentName: "S", modeLabel: "Cash", amount: "100.00", reason: "x" }],
    );
    expect(totals.received).toBe("1500.00");
    expect(totals.waiting).toBe("500.00");
    expect(totals.refunded).toBe("100.00");
    expect(totals.cashInHand).toBe("900.00");
  });
});
