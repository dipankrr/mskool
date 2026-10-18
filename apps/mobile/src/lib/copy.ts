/**
 * English strings only (Step 0). Vocabulary mirrors apps/web's `lib/copy.ts`
 * so both clients phrase the same failure the same way. A later locale adds
 * files under a real i18n setup (react-i18next + expo-localization) with the
 * in-app override — no screen is touched then. Screens read this module, never
 * literals, so the key-per-string discipline already holds.
 */

/** Strings shared across flows (a control rendered on more than one screen). */
const common = {
  retry: "Retry",
  saving: "Saving…",
} as const;

export const copy = {
  common,
  /** Read by `lib/errors.ts`. Nothing else should phrase a failure. */
  errors: {
    signedOut: "Your session expired. Please sign in again.",
    forbidden: "You don't have permission to do this. Ask your administrator.",
    notFound: "This record is no longer available. It may have been closed or moved.",
    invalid: "Some details need fixing. Check the highlighted fields and try again.",
    conflict: "That conflicts with something already saved. Check the details and try again.",
    network: "Couldn't reach the server. Check your connection and try again.",
    server: "Something went wrong on our side. Please try again.",
    tooMany: "Too many attempts. Wait a moment and try again.",
    unknown: "Something went wrong. Please try again.",
  },
  auth: {
    appName: "mskool",
    signInTitle: "Sign in",
    emailLabel: "Email",
    passwordLabel: "Password",
    signInAction: "Sign in",
    signingIn: "Signing in…",
    invalidCredentials:
      "Those details didn't match. Check them and try again.",
    forcedChangeTitle: "Set your own password",
    forcedChangeBody:
      "For security, set your own password before continuing. You cannot skip this step.",
    currentPasswordLabel: "Current password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    passwordMismatch: "The new passwords don't match.",
    changeAction: "Set password",
    changing: "Setting password…",
    signOutAction: "Sign out",
    signOutFailed: "Couldn't sign out. Check your connection and try again.",
  },
  session: {
    loading: "Checking your session…",
    loadFailed: "Couldn't check your session.",
    retry: common.retry,
    /** A resolved branch whose current year is unset — home and attendance. */
    noYearTitle: "No session is set",
    noYearBody:
      "The current academic session isn't set for this branch. Ask your administrator.",
  },
  /** The section list shared by home and attendance. */
  classes: {
    emptyTitle: "No classes assigned",
    emptyBody: "No sections are assigned to you in this session yet.",
  },
  nav: {
    home: "Home",
    attendance: "Attendance",
    more: "More",
  },
  home: {
    title: "Today",
    classesLabel: "Your classes",
    classTeacher: "Class teacher",
    notMarked: "Attendance not marked",
    /** `count` = students currently marked present for the day. */
    markedPresent: (count: number) => `Marked · ${count} present`,
    /** Hint on the class card, whose tap opens the attendance screen. */
    openHint: "Opens attendance for this section",
  },
  more: {
    title: "More",
    branch: "Branch",
    session: "Session",
    notSet: "Not set",
  },
  attendance: {
    /** Screen and alert title (the tab label lives in `nav`). */
    title: "Attendance",
    noAccessTitle: "Attendance isn't in your account",
    noAccessBody:
      "Your role doesn't include the attendance permission. Ask your administrator.",
    marking: {
      studentsCount: (count: number) =>
        count === 1 ? "1 student" : `${count} students`,
      roll: (roll: string) => `Roll ${roll}`,
      /** Shown where a roster row has no roll number assigned. */
      noRoll: "No roll number",
      allPresent: "All present",
      allAbsent: "All absent",
      tapHint: "Tap: present / absent · Hold: late, leave, half day",
      statuses: {
        present: "Present",
        absent: "Absent",
        late: "Late",
        half_day: "Half day",
        on_leave: "On leave",
      },
      save: "Save attendance",
      saved: "Attendance saved",
      edit: "Edit",
      statusSheetTitle: "Set status",
      dayPickerTitle: "Pick a day",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      dayTypes: {
        working: "Working",
        half_day: "Half day",
        exam_day: "Exam day",
        holiday: "Holiday",
        weekend: "Weekend",
        none: "Not set",
      },
      today: "Today",
      reason: "Reason for this correction",
      reasonPlaceholder: "Optional — why the change?",
      reasonHelp:
        "Optional — only the students whose status changes need a reason. Leaving it blank keeps any earlier note.",
      changedCount: (count: number) =>
        count === 1
          ? "1 student changing — say why:"
          : `${count} students changing — say why:`,
      readOnly:
        "You can view this section's day but not mark it — marking needs the attendance:create permission.",
      gateTitle: "This day cannot be marked",
      gateHoliday: (date: string) =>
        `${date} is a holiday — attendance cannot be marked on a holiday.`,
      gateWeekend: (date: string) =>
        `${date} is a weekend — attendance cannot be marked on a weekend.`,
      gateNoCalendar: (date: string) =>
        `${date} has no calendar entry. Generate the year's calendar first, then mark attendance.`,
      gateOther: (date: string) =>
        `${date} is not a day attendance can be marked on.`,
      rosterEmptyTitle: "No students enrolled",
      rosterEmptyBody: "No students are enrolled in this section yet.",
      loading: "Loading the roster…",
      /** Screen-reader strings for the roster rows. */
      a11y: {
        row: (name: string, roll: string | null, status: string) =>
          `${name}, ${roll ? `Roll ${roll}, ` : ""}status ${status}`,
        rowHint:
          "Double tap to change status, double tap and hold for all statuses",
        changeAction: "Change status",
      },
    },
  },
} as const;
