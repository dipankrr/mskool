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
  ok: "OK",
  back: "Back",
  cancel: "Cancel",
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
    invalidCredentials: "Those details didn't match. Check them and try again.",
    forcedChangeTitle: "Set your own password",
    forcedChangeBody:
      "For security, set your own password before continuing. You cannot skip this step.",
    currentPasswordLabel: "Current password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    passwordMismatch: "The new passwords don't match.",
    currentPasswordMismatch:
      "That current password doesn't match. Check it and try again.",
    changeAction: "Set password",
    changing: "Setting password…",
    /** Voluntary change, entered from Profile — no "you cannot skip" warning. */
    voluntaryChangeTitle: "Change password",
    voluntaryChangeBody: "Enter your current password, then choose a new one.",
    changePasswordAction: "Change password",
    backToProfile: "Back to profile",
    passwordChangedTitle: "Password changed",
    passwordChangedBody: "Use your new password the next time you sign in.",
    signOutAction: "Sign out",
    signOutFailed: "Couldn't sign out. Check your connection and try again.",
  },
  session: {
    loading: "Checking your session…",
    loadFailed: "Couldn't check your session.",
    retry: common.retry,
    /** A resolved branch whose current year is unset — home and attendance. */
    noYearTitle: "No session is set",
    noYearBody: "The current academic session isn't set for this branch. Ask your administrator.",
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
    loading: "Loading…",
    /** Pressable variant of the session row: the value says what a tap does. */
    sessionRetry: "Couldn't load · Tap to retry",
    sessionRetryHint: "Reloads the current session",
    branchHint: "Opens the branch picker",
    branchSheetTitle: "Choose branch",
    workspace: "Workspace",
    manage: "Manage",
    account: "Account",
    branches: "Branches",
    branchesDetail: "Names, codes and contacts",
    branchesHint: "Opens the branch list",
    sessions: "Sessions",
    sessionsDetail: "Academic years and the running one",
    sessionsHint: "Opens the session list",
    profile: "Profile and access",
    profileDetail: "Roles, scopes and permissions",
    profileHint: "Opens your profile and permissions",
  },
  profile: {
    title: "Profile and access",
    back: "Back",
    account: "Account",
    organization: "Organization",
    access: "Your access",
    roles: "Roles",
    scopes: "Scopes",
    permissionsLabel: "Permissions",
    noRoles: "No roles assigned",
    noScopes: "No scope recorded",
    noPermissions: "No permissions granted. Ask your administrator.",
    permissionCount: (count: number) =>
      count === 1 ? "1 permission" : `${count} permissions`,
    showPermissions: "Show every permission on this account",
    hidePermissions: "Hide the permission list",
    changePassword: "Change password",
    changePasswordDetail: "Choose a new password for your account",
    changePasswordHint: "Opens the password form",
  },
  /**
   * Shared form behaviour. The field labels live with their domain; these are
   * the words every form uses (leaving with unsaved work, a picker's hint).
   */
  forms: {
    optional: "Optional",
    discardTitle: "Discard changes?",
    discardBody: "Your changes on this form have not been saved.",
    keepEditing: "Keep editing",
    discard: "Discard",
    invalidSummary: "Check the highlighted fields before saving.",
    datePickerHint: "Opens the date picker.",
    dateNotSet: "Choose a date",
    done: "Done",
    readOnly:
      "You can see these details, but changing them needs a permission your account does not have.",
  },
  /** Honest refusals for a screen reached without its read/write grant. */
  denied: {
    branchesReadTitle: "Branches aren't in your account",
    branchesReadBody:
      "Seeing the trust's branches needs the school:read permission. Ask your administrator.",
    branchesWriteTitle: "Branch management isn't in your account",
    branchesWriteBody:
      "Adding, editing or closing a branch needs a school management permission. Ask your administrator.",
    sessionsReadTitle: "Sessions aren't in your account",
    sessionsReadBody:
      "Seeing academic sessions needs the academic_year:read permission. Ask your administrator.",
    sessionsWriteTitle: "Session management isn't in your account",
    sessionsWriteBody:
      "Adding or changing a session needs a session management permission. Ask your administrator.",
  },
  /** Chunk B — the trust's branches (`school.*`). */
  branches: {
    title: "Branches",
    add: "Add branch",
    addTitle: "Add a branch",
    editTitle: "Edit branch",
    emptyTitle: "No branches yet",
    emptyBody: "Add the first school in this trust to begin.",
    loading: "Loading branches…",
    noOrgTitle: "No organization yet",
    noOrgBody:
      "This account isn't attached to a trust yet. Ask your administrator.",
    current: "Current",
    openHint: "Opens this branch's details",
    sections: {
      basics: "The basics",
      contact: "Contact",
      records: "Records",
    },
    fields: {
      name: "Name",
      nameHelp: "What people call this school day to day.",
      legalName: "Registered name",
      legalNameHelp: "As it appears on official records.",
      code: "Code",
      codeHelp: "A short identifier in capitals, used on receipts and reports.",
      board: "Board",
      boardHelp: "Which examination board this school follows.",
      email: "Email",
      phone: "Phone",
      city: "City",
      state: "State",
      pincode: "Pincode",
      udiseCode: "UDISE code",
      udiseHelp: "11 digits, if this school has one.",
    },
    boards: {
      cbse: "CBSE",
      icse: "ICSE",
      state: "State board",
      ib: "IB",
      unaffiliated: "Not affiliated yet",
    },
    closeNoticeTitle: "Close this branch",
    closeNoticeBody:
      "It leaves the branch list and staff can no longer work in it. Nothing is deleted — students, payments and results stay exactly as they are. If it is the branch you are using, the app switches to another one.",
    closeAction: "Close branch",
    closing: "Closing…",
    closeConfirmTitle: "Close this branch?",
    closeConfirmBody:
      "Staff will no longer be able to work in it, and it leaves the branch list. Students, payments and results stay exactly as they are.",
    closeConfirm: "Close branch",
    save: "Save branch",
    created: "Branch added.",
    errors: {
      name: "Enter the branch's name (at least 2 characters).",
      legalName: "Enter the registered name (at least 2 characters).",
      code: "Enter a short code for receipts and reports.",
      codeFormat: "Use capitals, numbers and hyphens only.",
      email: "Enter a valid email address.",
      phone: "Enter 10–20 characters, including the country code if needed.",
      pincode: "Enter a 6-digit pincode that does not start with 0.",
      udiseCode: "UDISE codes are 11 digits.",
    },
  },
  /** Chunk B — academic years, and the one a branch is running. */
  sessions: {
    title: "Sessions",
    add: "Add session",
    addTitle: "Add a session",
    editTitle: "Edit session",
    emptyTitle: "No session yet",
    emptyBody:
      "A session is one academic year. Classes and sections hang off it, so this comes first.",
    loading: "Loading sessions…",
    noBranchTitle: "Choose a branch first",
    noBranchBody:
      "Sessions belong to one branch. Pick the branch you are working in from More, then come back.",
    noBranchAction: "Back to More",
    runningGroup: "Running session",
    otherGroup: "Other sessions",
    otherGroupCount: (count: number) =>
      count === 1 ? "Other sessions · 1" : `Other sessions · ${count}`,
    statuses: {
      running: "Running",
      upcoming: "Upcoming",
      not_running: "Not running",
      past: "Past",
    },
    openHint: "Opens this session",
    noCurrentTitle: "No session is running",
    noCurrentBody:
      "Staff cannot mark attendance until one is. Open a session below and make it the running one.",
    historyHiddenTitle: "Older sessions are hidden",
    historyHiddenBody:
      "Your access covers the running session only. Ask an administrator if you need a past year.",
    startYearLabel: "Which year does it start in?",
    startYearHelp:
      "Picking a year fills 1 April to 31 March and names the session. You can change the dates after.",
    detailsGroup: "Session details",
    alreadyAdded: "Already added",
    fields: {
      name: "Name",
      nameHelp: "Usually the two years it spans, like 2026-27.",
      startDate: "Starts on",
      endDate: "Ends on",
      datesHelp: "Both dates are inclusive.",
    },
    runningNoticeTitle: "This is the running session",
    runningNoticeBody: "This is what every colleague sees by default.",
    makeRunningTitle: "Make this the running session",
    makeRunningBody:
      "Every colleague's default view moves to this session. The one running now becomes a past session. Nothing is deleted, and you can switch back.",
    makeRunningAction: "Make this the running session",
    makeRunningDirty:
      "Save your changes first. Switching the running session cannot include dates you have not saved yet.",
    makeRunningConfirmTitle: "Make this the running session?",
    makeRunningConfirmBody:
      "Every colleague's default view moves here, and the session running now becomes past. Nothing is deleted.",
    makeRunningConfirm: "Make it running",
    makingRunning: "Changing the running session…",
    save: "Save session",
    errors: {
      name: "Give the session a name (4–20 characters).",
      startDate: "Choose a start date.",
      endDate: "Choose an end date.",
      dateOrder: "The session cannot end before it starts.",
      overlap: (name: string) =>
        `These dates overlap ${name}. A branch can run only one session at a time.`,
    },
  },
  attendance: {
    /** Screen and alert title (the tab label lives in `nav`). */
    title: "Attendance",
    noAccessTitle: "Attendance isn't in your account",
    noAccessBody: "Your role doesn't include the attendance permission. Ask your administrator.",
    /** Section captions shared by the marking and summary panels. */
    studentsCount: (count: number) => (count === 1 ? "1 student" : `${count} students`),
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
      /** The hero is coverage; the official rate is the secondary figure. */
      coverageLabel: "Days marked",
      coverageOf: (marked: number, working: number) =>
        `${marked} of ${working} working days marked`,
      daysMarked: (count: number) => (count === 1 ? "Day marked" : "Days marked"),
      officialRateLabel: "Official year rate",
      officialRateNote:
        "Present against the session calendar. Half days are marked, not present.",
      howCalculated: "How this is calculated",
      presentOfMarked: (present: number, marked: number) => `${present}/${marked}`,
      presentShareLabel: "Present share",
      presentShareNote: "Present days out of all marked days.",
      markToday: "Mark today's attendance",
      noMarksTitle: "No attendance yet",
      noMarksBody: "Mark today's register to start the year.",
      sortLabel: "Order",
      sortRoll: "Roll order",
      sortTop: "Top present",
      sortMostAbsent: "Most absent",
      sortA11y: (current: string) => `Student order: ${current}. Double tap to change.`,
      calculation: {
        title: "How this is calculated",
        coverageTitle: "Days marked",
        coverageBody:
          "The student with the most marked days. Present, absent, late, half day and on-leave all count. The bar compares that against the session's working calendar.",
        officialTitle: "Official year rate",
        officialBody:
          "Present days divided by the session's full working calendar. It rises as days are marked and is the figure exam eligibility reads. Half day is a marked day but does not count as present here.",
        markedTitle: "Present share of marked days",
        markedBody:
          "Present days divided by all marked days for that student, including half days. It is a day-to-day read, not a policy threshold.",
        close: "Close",
      },
      detail: {
        title: "Attendance so far",
        covered: (working: number) => `of ${working} working days marked`,
        statusMix: "Status mix",
        officialRate: "Official rate",
        presentShare: "Present share",
        attendanceMap: "Attendance map",
        mapEmpty: "No attendance marked in this month.",
        noData: "No attendance has been marked for this student yet.",
        halfDayNote:
          "Half day counts as a marked day in present share, but not as present in the official year rate.",
        close: "Close",
      },
      /** The list's group label (probe section anatomy). */
      studentsLabel: "Students",
      /** Shown where nothing has been marked yet. */
      noValue: "—",
      ofWorkingDays: (working: number) => `of ${working} working days`,
      /** The coverage caption when the section has no rows at all. */
      noCoverageYet: "No days marked yet",
      present: (count: number) => `${count} present`,
      absent: (count: number) => `${count} absent`,
      late: (count: number) => `${count} late`,
      halfDay: (count: number) => `${count} half day`,
      onLeave: (count: number) => `${count} on leave`,
      /** The roster's compact status key, e.g. "2P 1A 1L 1H 1OL". */
      shortCount: {
        present: (count: number) => `${count}P`,
        absent: (count: number) => `${count}A`,
        late: (count: number) => `${count}L`,
        halfDay: (count: number) => `${count}H`,
        onLeave: (count: number) => `${count}OL`,
      },
      noneYet: "No attendance yet",
      /** Only rendered when someone in the roster has no rows at all. */
      noDataLine: (count: number) =>
        count === 1
          ? "1 student has no attendance yet"
          : `${count} students have no attendance yet`,
      a11y: {
        row: (name: string, detail: string, presentOfMarked: string) =>
          `${name}, ${detail}, ${presentOfMarked} marked days present`,
        rowHint: "View attendance details",
        none: (name: string) => `${name}, no attendance marked yet`,
      },
    },
    marking: {
      roll: (roll: string) => `Roll ${roll}`,
      /** Shown where a roster row has no roll number assigned. */
      noRoll: "No roll number",
      /** The one day-composition card above the roster. */
      pulseLabel: "Day so far",
      pulsePresentLabel: "present",
      pulsePresentShare: (percent: number) => `${percent}% of marked present`,
      allPresent: "Mark all present",
      allAbsent: "Mark all absent",
      tapHint: "Tap a blank row for present · Tap again for absent · Hold for more",
      unmarked: "Not marked",
      unmarkedShort: "–",
      statuses: {
        present: "Present",
        absent: "Absent",
        late: "Late",
        half_day: "Half day",
        on_leave: "On leave",
      },
      statusDescriptions: {
        present: "In class for the whole day",
        absent: "Not in class",
        late: "Arrived after the late window",
        half_day: "Attended part of the day",
        on_leave: "Approved absence",
      },
      statusShort: {
        present: "P",
        absent: "A",
        late: "L",
        half_day: "½",
        on_leave: "OL",
      },
      save: "Save attendance",
      saveChanges: (count: number) => (count === 1 ? "Save 1 change" : `Save ${count} changes`),
      saveProgress: (marked: number, total: number) => `${marked} of ${total} marked`,
      saved: "Attendance done",
      doneTitle: "Attendance done",
      doneBody: (count: number) =>
        count === 1 ? "1 student marked for this day." : `${count} students marked for this day.`,
      doneEdit: "Edit",
      doneEditHint: "Edit this day's attendance",
      doneAction: "Done",
      edit: "Edit",
      statusSheetTitle: "Set status",
      statusSheetHint: "Choose one status for this student's day.",
      dayPickerTitle: "Pick a day",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      sessionRange: (start: string, end: string) => `Session ${start} – ${end}`,
      outsideSession: "Today is outside this session. Pick a day inside it.",
      outsideSessionA11y: (date: string) => `${date} is outside this session.`,
      selectedDay: "Selected day",
      holidayWeekendLegend: "Holiday / weekend",
      examLegend: "Exam day",
      workingLegend: "Working",
      markedLegend: "Marked",
      unmarkedPastLegend: "Past, not marked",
      marked: "Marked",
      notMarked: "Not marked",
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
        count === 1 ? "1 student changing — say why:" : `${count} students changing — say why:`,
      readOnly:
        "You can view this section's day but not mark it — marking needs the attendance:create permission.",
      gateTitle: "This day cannot be marked",
      gateHoliday: (date: string) =>
        `${date} is a holiday — attendance cannot be marked on a holiday.`,
      gateWeekend: (date: string) =>
        `${date} is a weekend — attendance cannot be marked on a weekend.`,
      gateNoCalendar: (date: string) =>
        `${date} has no calendar entry. Generate the year's calendar first, then mark attendance.`,
      gateOther: (date: string) => `${date} is not a day attendance can be marked on.`,
      recentLabel: "Recent",
      recentHint: (count: number) =>
        count === 1 ? "Last marked day" : `Last ${count} marked days`,
      recentEmpty: "No earlier marks",
      recentA11y: (date: string, status: string) => `${date}: ${status}`,
      rosterEmptyTitle: "No students enrolled",
      rosterEmptyBody: "No students are enrolled in this section yet.",
      loading: "Loading the roster…",
      /** Screen-reader strings for the roster rows. */
      a11y: {
        row: (name: string, roll: string | null, status: string) =>
          `${name}, ${roll ? `Roll ${roll}, ` : ""}status ${status}`,
        rowHint: "Double tap to change status, double tap and hold for all statuses",
        changeAction: "Change status",
        recent: (name: string, days: string) => `${name}, recent days: ${days}`,
      },
    },
    /** Chunk 3 — the management surfaces behind the header gear. */
    manage: {
      /** The header gear and the hub's shared words. */
      open: "Manage attendance",
      openHint: "Calendar, marking policy and periods",
      title: "Manage attendance",
      back: "Back",
      sessionLabel: "Session settings",
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
        periodThreshold: (percent: string) => `Period-wise · threshold ${percent}%`,
        lateWindow: (minutes: number) => `${minutes}-min late window`,
        unset: "Not set — defaults apply",
      },
      /** The calendar row's live subtitle, from the session's day rows. */
      calendarSummary: {
        unset: "Not generated — set the year's days",
        working: (count: number) => (count === 1 ? "1 working day" : `${count} working days`),
        nextHoliday: (date: string, reason: string | null) =>
          `Next holiday ${date}${reason ? ` · ${reason}` : ""}`,
        noNextHoliday: "No holidays ahead",
        missingMonth: (count: number) =>
          count === 1 ? "1 day this month has no entry" : `${count} days this month have no entry`,
      },
      /** The periods row's live subtitle, by count. */
      periodsSummary: {
        count: (count: number, section: string) =>
          count === 1 ? `1 period · ${section}` : `${count} periods · ${section}`,
        none: (section: string) => `No periods yet · ${section}`,
      },
      /** The manage calendar: month list, day editor, generate sheet. */
      calendar: {
        generate: "Generate calendar",
        monthEmpty: "No days set for this month — generate the calendar.",
        editorTitle: "Set the day type",
        reason: "Reason",
        reasonPlaceholder: 'Optional — "Diwali", "Sports day"…',
        reasonHelp: "Shown wherever this day is read. Leave it empty to remove the note.",
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
        weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
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
        filled: (count: number) => (count === 1 ? "1 day filled in." : `${count} days filled in.`),
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
        ruleHelp: "How a period-wise day resolves to a present or absent day.",
        ruleHomeroom: "Homeroom decides",
        ruleThreshold: "Threshold",
        thresholdLabel: "Threshold %",
        thresholdHelp: "A day counts present once this share of its periods is present.",
        lateLabel: "Late arrival window",
        lateHelp: "A mark later than this many minutes past the period's start reads as late.",
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
        emptyBody: "Add this section's timetable slots so period-wise marking can start.",
        add: "Add period",
        times: (start: string, end: string) => `${start}–${end}`,
        startsAt: (start: string) => `Starts ${start}`,
        endsAt: (end: string) => `Ends ${end}`,
        noTimes: "No times set",
        homeroom: "Homeroom",
        rowA11y: (sequence: number, name: string, detail: string, homeroom: boolean) =>
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
