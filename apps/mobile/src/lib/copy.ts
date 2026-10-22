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
    /** Section captions shared by the marking and summary panels. */
    studentsCount: (count: number) =>
      count === 1 ? "1 student" : `${count} students`,
    /** The Mark ⇄ Summary segments (chunk 2). */
    views: {
      mark: "Mark",
      summary: "Summary",
    },
    viewsA11y: {
      mark: "Mark attendance",
      summary: "Attendance summary",
    },
    /** The section switcher (chunk 2). */
    section: {
      open: "Choose a section",
      sheetTitle: "Pick a section",
    },
    /** The yearly summary panel (chunk 2). */
    summary: {
      /** The year card's uppercase label. */
      yearLabel: "Year so far",
      /** The hero number's caption. */
      averageLabel: "Average attendance",
      /** The list's group label (probe section anatomy). */
      studentsLabel: "Students",
      /** Shown where nothing has been marked yet. */
      noValue: "—",
      /** The coverage bar's caption when the year has working days. */
      coverage: (marked: number, working: number) =>
        `${marked} of ${working} days marked`,
      /** The coverage caption when the section has no rows at all. */
      noCoverageYet: "No days marked yet",
      present: (count: number) => `${count} present`,
      absent: (count: number) => `${count} absent`,
      late: (count: number) => `${count} late`,
      onLeave: (count: number) => `${count} on leave`,
      noneYet: "No attendance yet",
      /** Only rendered when someone in the roster has no rows at all. */
      noDataLine: (count: number) =>
        count === 1
          ? "1 student has no attendance yet"
          : `${count} students have no attendance yet`,
      footnote:
        "The average counts present days against the session's full working calendar, so it rises as days get marked — the same figure exam eligibility reads.",
      a11y: {
        row: (name: string, detail: string, percent: string) =>
          `${name}, ${detail}, ${percent} attendance`,
        none: (name: string) => `${name}, no attendance marked yet`,
      },
    },
    marking: {
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
    /** Chunk 3 — the management surfaces behind the header gear. */
    manage: {
      /** The header gear and the hub's shared words. */
      open: "Manage attendance",
      openHint: "Calendar, marking policy and periods",
      title: "Manage attendance",
      back: "Back",
      noAccessTitle: "Management isn't in your account",
      noAccessBody:
        "Changing the calendar, marking policy and periods needs the attendance:update permission. Ask your administrator.",
      /** The hub's three rows; the hints double as fallback subtitles. */
      rows: {
        calendar: "Calendar",
        calendarHint: "Generate the year, set holidays and exam days",
        policy: "Marking policy",
        policyHint: "Marking mode, daily rule and late window",
        periods: "Periods",
        periodsHint: "Section timetable slots for period-wise marking",
      },
      /** The policy row's live subtitle, by stored shape. */
      policySummary: {
        daily: "Daily marking",
        periodHomeroom: "Period-wise · Homeroom decides",
        periodThreshold: (percent: string) =>
          `Period-wise · threshold ${percent}%`,
        unset: "Not set — defaults apply",
      },
      /** The periods row's live subtitle, by count. */
      periodsSummary: {
        count: (count: number, section: string) =>
          count === 1
            ? `1 period · ${section}`
            : `${count} periods · ${section}`,
        none: (section: string) => `No periods yet · ${section}`,
      },
      /** The manage calendar: month list, day editor, generate sheet. */
      calendar: {
        generate: "Generate calendar",
        monthEmpty: "No days set for this month — generate the calendar.",
        editorTitle: "Set the day type",
        reason: "Reason",
        reasonPlaceholder: 'Optional — "Diwali", "Sports day"…',
        reasonHelp:
          "Shown wherever this day is read. Leave it empty to remove the note.",
        save: "Save day",
        /** One line per day type, in sheet order. */
        meanings: {
          working: "School in session — markable",
          holiday: "Closed all day — not markable",
          half_day: "Partial day — markable",
          exam_day: "Exams — markable",
          weekend: "Weekly off — not markable",
        },
        /** The generate sheet. */
        generateHelp:
          "Pick the days a week school is in session. Days already set are left untouched — this only fills gaps.",
        weekdays: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        weekdayA11y: (weekday: string, state: string) =>
          `${weekday}, ${state}. Double tap to change.`,
        states: {
          working: "Working",
          half_day: "Half day",
          off: "Off",
        },
        minWorking: "At least one working day a week.",
        confirm: "Generate",
        running: "Generating…",
        done: "Done",
        filled: (count: number) =>
          count === 1 ? "1 day filled in." : `${count} days filled in.`,
        filledNone: "Every day already had a row — nothing to add.",
      },
      /** The marking policy screen. */
      policy: {
        unsetTitle: "Not set yet",
        unsetBody:
          "The server's defaults apply: daily marking, homeroom decides the day, a 15-minute late window. Saving creates this school's policy.",
        modeLabel: "Marking mode",
        modeHelp:
          "Daily: one mark per student per day. Period-wise: a mark per period, and the day's status derives from the rule.",
        modeDaily: "Daily",
        modePeriod: "Period-wise",
        ruleLabel: "Daily status rule",
        ruleHelp:
          "How a period-wise day resolves to a present or absent day.",
        ruleHomeroom: "Homeroom decides",
        ruleThreshold: "Threshold",
        thresholdLabel: "Threshold %",
        thresholdHelp:
          "A day counts present once this share of its periods is present.",
        lateLabel: "Late arrival window",
        lateHelp:
          "A mark later than this many minutes past the period's start reads as late.",
        minutesSuffix: "min",
        caution: (section: string) =>
          `Period-wise marking needs ${section}'s periods — add them before the first marking.`,
        cautionAction: "Add periods",
        save: "Save policy",
        saved: "Policy saved",
        errors: {
          threshold: "Enter a threshold between 1 and 100.",
          late: "Enter minutes between 0 and 120.",
        },
      },
      /** The periods list and its editor. */
      periods: {
        dailyNote:
          "This school marks daily — periods matter when it switches to period-wise marking.",
        emptyTitle: "No periods yet",
        emptyBody:
          "Add this section's timetable slots so period-wise marking can start.",
        add: "Add period",
        times: (start: string, end: string) => `${start}–${end}`,
        startsAt: (start: string) => `Starts ${start}`,
        endsAt: (end: string) => `Ends ${end}`,
        noTimes: "No times set",
        homeroom: "Homeroom",
        rowA11y: (
          sequence: number,
          name: string,
          detail: string,
          homeroom: boolean,
        ) =>
          `Period ${sequence}, ${name}, ${detail}${homeroom ? ", homeroom" : ""}`,
        editorNew: "New period",
        editorEdit: "Edit period",
        name: "Name",
        namePlaceholder: "Period 1",
        sequence: "Sequence",
        sequenceHelp: "Where it sits in the day, 1–30.",
        starts: "Starts",
        ends: "Ends",
        notSet: "Not set",
        clear: "Clear",
        homeroomLabel: "Homeroom period",
        homeroomHelp:
          "Daily status is read from the homeroom period on homeroom-decides schools. One per section stays the rule.",
        save: "Save period",
        done: "Done",
        errors: {
          name: "Give the period a name (1–50 characters).",
          sequence: "Enter a sequence between 1 and 30.",
          timeOrder: "The end time cannot be before the start time.",
        },
      },
    },
  },
} as const;
