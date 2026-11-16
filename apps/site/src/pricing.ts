// Plans and prices for the pricing page. Rupees per student per month, GST extra.
// "yearly" is the rate when billed for the year, "monthly" when billed month by month.
export type PlanId = "office" | "school" | "group";
export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  yearly: number;
  monthly: number;
  popular?: boolean;
  bullets: string[];
}

export const PLANS: Plan[] = [
  {
    id: "office", name: "Office", tagline: "Run the office: admissions, fees, attendance.",
    yearly: 4, monthly: 5,
    bullets: ["Students and admissions", "Fees, receipts and UPI QR", "Student and staff attendance", "ID cards", "Notices to WhatsApp"],
  },
  {
    id: "school", name: "School", tagline: "The whole school: office, teachers and parents.",
    yearly: 6, monthly: 7, popular: true,
    bullets: ["Everything in Office", "Exams and report cards", "Homework and quizzes", "Timetable", "Parent and student app"],
  },
  {
    id: "group", name: "Group", tagline: "For owners who run more than one branch.",
    yearly: 8, monthly: 10,
    bullets: ["Everything in School", "Many branches, one login", "Owner view across branches", "Same-day priority support", "A named person for your setup"],
  },
];

/** Schools smaller than this are billed as if they had this many students. */
export const MIN_STUDENTS = 150;
export const TRIAL_DAYS = 30;
export const DEFAULT_STUDENTS = 400;

const ALL: PlanId[] = ["office", "school", "group"];
const UP: PlanId[] = ["school", "group"];
/** Which plans include each row of the comparison table. */
export const COMPARE: { group: string; rows: [string, PlanId[]][] }[] = [
  { group: "Office", rows: [
    ["Students and admissions", ALL],
    ["Fees, receipts and UPI QR", ALL],
    ["Student and staff attendance", ALL],
    ["ID cards", ALL],
    ["Notices and PDFs to WhatsApp", ALL],
    ["Staff roles and permissions", ALL],
    ["Office web app and staff app", ALL],
  ] },
  { group: "Teaching", rows: [
    ["Exams, marks and report cards", UP],
    ["Homework and quizzes", UP],
    ["Timetable", UP],
  ] },
  { group: "Families", rows: [
    ["Parent and student app", UP],
    ["Results and fees on the parent's phone", UP],
  ] },
  { group: "Owners", rows: [
    ["Many branches, one login", ["group"]],
    ["Owner view across branches", ["group"]],
    ["Same-day priority support", ["group"]],
    ["A named person for your setup", ["group"]],
  ] },
];
