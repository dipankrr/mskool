/**
 * EVERY USER-FACING STRING IN THE CONSOLE.
 *
 * One place, for three reasons.
 *
 * **Vocabulary stays consistent.** The people using this are school staff, not
 * developers, and the schema's words are not theirs. A `school` row is a *branch*
 * of a trust; an `academic_year` is a *session*; `is_active = false` is *closed*,
 * not "deactivated". If those translations live at each call site they drift, and
 * a user who learns "close" on one screen meets "deactivate" on the next and
 * cannot tell whether it is the same action.
 *
 * **One action keeps one name.** The button, the dialog title, the confirm and the
 * toast for closing a branch all read from the same entry here, so they cannot
 * disagree about what just happened.
 *
 * **A Hindi or regional translation becomes additive.** Not planned, but the whole
 * cost of allowing it later is paid by keeping the strings out of the components
 * now.
 *
 * Rules for anything added here: name things by what the user controls, not by how
 * the system is built; say what happened *and* what to do next; and never promise
 * deletion for something that is only closed, because student records, payments
 * and results keep pointing at it.
 */

export const copy = {
  /**
   * The translation table itself.
   *
   * `school` and `branch` are both here on purpose. A trust with one school calls
   * it "the school"; a trust with four calls each one a "branch". Use
   * `branchWord(count)` rather than picking one.
   */
  terms: {
    school: "School",
    schools: "Schools",
    branch: "Branch",
    branches: "Branches",
    session: "Session",
    sessions: "Sessions",
    class: "Class",
    classes: "Classes",
    section: "Section",
    sections: "Sections",
    /** Appended wherever something is closed, never omitted. */
    recordsKept: "Records are kept and stay visible.",
  },

  app: {
    name: "mskool",
    /** Shown while the bootstrap call resolves. Never a spinner-only screen. */
    loading: "Loading your school…",
  },

  nav: {
    home: "Home",
    branches: "Branches",
    sessions: "Sessions",
    classes: "Classes",
    students: "Students",
    attendance: "Calendar",
    profile: "Profile",
    menu: "Menu",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    toggleTheme: "Toggle theme",
    signOut: "Sign out",
    /** The hamburger sheet: everything that decides what the app is showing you. */
    contextTitle: "What you're working on",
    contextSubtitle: "Choose the branch and session these screens apply to.",
    chooseBranch: "Choose a branch",
    noBranch: "No branch",
    organization: "Trust",
    signedInAs: "Signed in as",
  },

  /** The Profile destination. Not a dropdown — a page, so nothing is hidden. */
  profile: {
    title: "Profile",
    subtitle: "Your account and how this app is set up for you.",
    account: "Account",
    access: "Access",
    roles: "Roles",
    scope: "Scope",
    permissionCount: "Permissions",
    appearance: "Appearance",
    appearanceHelp: "Light, dark, or whatever your phone is set to.",
    signOutHelp: "You will need your email and password to sign back in.",
  },

  /** Reused controls. If a verb appears twice in the app it belongs here. */
  common: {
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",
    edit: "Edit",
    add: "Add",
    create: "Create",
    retry: "Try again",
    back: "Back",
    search: "Search",
    filters: "Filters",
    clear: "Clear",
    loading: "Loading…",
    required: "Required",
    optional: "Optional",
    yes: "Yes",
    no: "No",
    actions: "Actions",
    active: "Active",
    closed: "Closed",
    current: "Current",
    /** Placeholder for a value the row does not have. */
    none: "—",
    /** A destination that exists in the navigation before its screen does. */
    notBuiltYetTitle: "Not built yet",
    notBuiltYetBody: "This screen is coming next. The navigation is here first so nothing dead-ends.",
  },

  auth: {
    signInTitle: "Sign in",
    signInSubtitle: "Use the email address your school gave you.",
    email: "Email",
    password: "Password",
    forgotPassword: "Forgot your password?",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signedIn: "Signed in.",
    /**
     * There is no sign-up. Accounts are issued by the school (ADR-021), and a
     * visitor who cannot get in needs to know who to ask, not a link that fails.
     */
    noSelfSignUp:
      "Accounts are issued by your school. Contact your administrator if you cannot sign in.",
  },

  /** U1. `student.*` — the admission register. */
  students: {
    subtitle:
      "The admission register — every active student, searchable by name or admission number.",
    add: "Admit student",
    addTitle: "Admit a student",
    addHelp:
      "The admission number is permanent: it is printed on every document the school ever issues and is never reused.",
    created: "Student admitted.",
    searchLabel: "Search students",
    searchPlaceholder: "Search by name or admission number…",
    emptyTitle: "No students yet",
    emptyBody: "Admit the first student and the register starts here.",
    noResultsTitle: "No matches",
    noResultsBody:
      "No active student matches that search. Check the spelling, or try the admission number.",
    enrolledIn: "Class",
    notEnrolled: "Not enrolled this session",
    fields: {
      admissionNumber: "Admission number",
      admissionNumberHelp: "School-issued, permanent, never reused.",
      firstName: "First name",
      middleName: "Middle name",
      lastName: "Last name",
      dateOfBirth: "Date of birth",
      gender: "Gender",
      admissionDate: "Admission date",
      admissionDateHelp: "Defaults to today when left blank.",
      phone: "Phone",
      email: "Email",
    },
    genders: {
      male: "Male",
      female: "Female",
      other: "Other",
    },

    // U2 — the detail page and the enrollment actions.
    detailSubtitle: "The student's record: identity, session enrollment, and actions.",
    edit: "Edit details",
    editTitle: "Edit student details",
    updated: "Student updated.",
    deactivate: "Deactivate",
    deactivateTitle: "Deactivate this student's record?",
    deactivateBody:
      "The record leaves the active register but is not deleted — enrollments, fees and results keep pointing at it. A leaving student who needs a certificate needs a transfer instead.",
    deactivateConfirm: "Deactivate",
    deactivated: "Student deactivated.",
    enrollmentTitle: "This session",
    enrollment: {
      title: "Enrollment",
      none:
        "Not enrolled in the active session yet. Enrolling anchors this student to a class for the year.",
      enroll: "Enroll in session",
      enrollTitle: "Enroll into the active session",
      enrollHelp:
        "Enrolling anchors the student to a class for the session shown in the switcher. To enroll into a different session, switch sessions first.",
      class: "Class",
      section: "Section",
      sectionOptionalHelp:
        "Optional now — leave blank to admit without a section and assign one later.",
      enrolled: "Student enrolled.",
      rollNumber: "Roll number",
      rollNumberHelp: "Optional. The seat number within the section.",
      assignSection: "Assign section",
      assignSectionTitle: "Assign the first section",
      assignSectionHelp:
        "A student's first section assignment. Moving a student who already has one needs a transfer — that flow is not built yet, so this cannot be undone here.",
      assigned: "Section assigned.",
      statusLabel: "Status",
      noSection: "No section yet",
    },
    /** The enrollment life cycle (lowercase enum → words). */
    enrollmentStatuses: {
      admitted: "Admitted",
      section_assigned: "Section assigned",
      active: "Active",
      transferred_out: "Transferred out",
      withdrawn: "Withdrawn",
      passed_out: "Passed out",
    },
  },

  /** U3. `attendance.calendar.*` — the marking gate, made visible. */
  attendance: {
    title: "Academic calendar",
    subtitle:
      "The session's teaching days, holidays, and exams, month by month or the whole year at once. Attendance cannot be marked on a day this calendar refuses.",
    viewMonth: "Month",
    viewYear: "Full year",
    generate: "Generate calendar",
    fillGaps: "Fill missing days",
    generateTitle: "Generate the session's calendar",
    generateHelp:
      "Creates one row per date of the session from the weekly template below. Days already set are left untouched — a re-run fills gaps only.",
    workingWeekdays: "The week's shape",
    generateStates: {
      working: "Working",
      half_day: "Half day",
      off: "Off",
      help: "Tap a day to cycle: Working → Half day → Off. Every date of the session is created from this template — holidays are then set per date.",
    },
    weekdays: {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    },
    generated: (count: number) =>
      count === 1
        ? "Calendar generated — 1 day filled in."
        : `Calendar generated — ${count} days filled in.`,
    nothingToGenerate: "Calendar generated — every day already had a row.",
    overrideTitle: "Set the day type",
    reason: "Reason",
    reasonPlaceholder: "e.g. Diwali — leave blank to keep an existing reason",
    saved: "Calendar day saved.",
    override: "Override",
    dayTypes: {
      working: "Working",
      holiday: "Holiday",
      half_day: "Half",
      weekend: "Off",
      exam_day: "Exam",
    },
    noCalendarTitle: "No calendar for this month",
    noCalendarBody:
      "Generate the session's calendar once and every month fills in — marking is refused on a date the calendar does not describe.",
    noSession: "Choose a branch and a session to see its calendar.",
    policyLink: "Marking policy",
    policy: {
      title: "Marking policy",
      subtitle:
        "How this branch marks attendance. One policy per branch; it applies to every class and teacher.",
      defaultsInEffect:
        "No policy has been saved yet — the defaults below are already in effect. Saving creates the policy row.",
      markingMode: "Marking mode",
      markingModeHelp:
        "Daily marks the whole day once. Period-wise marks each period and derives the day from them.",
      dailyStatusRule: "How the day is derived",
      dailyStatusRuleHelp:
        "Period-wise only: the homeroom period decides the day, or a percentage of periods present does.",
      thresholdPercentage: "Present threshold (%)",
      thresholdPercentageHelp:
        "At or above this share of periods (present, late, or half day), the day counts as present.",
      lateArrivalMinutes: "Late-arrival window (minutes)",
      lateArrivalMinutesHelp:
        "How many minutes after the period starts a mark is Late rather than Present. A hint for markers.",
      saved: "Marking policy saved.",
      modes: { daily: "Daily", period_wise: "Period-wise" },
      rules: {
        homeroom_authoritative: "Homeroom period decides",
        threshold_percentage: "Percentage of periods",
      },
    },
    marking: {
      tabLabel: "Mark",
      title: "Mark attendance",
      subtitle:
        "One section, one date. The calendar decides whether the date can be marked at all.",
      section: "Section",
      date: "Date",
      period: "Period",
      periodHelp: "This branch marks attendance period by period — choose the period first.",
      roster: "Roster",
      status: "Status",
      notEnrolledInRoster: "No students are enrolled in this section yet.",
      markAllPresent: "Mark all present",
      markAllAbsent: "Mark all absent",
      holidayNote: "is a holiday — attendance cannot be marked on a holiday.",
      weekendNote: "is a weekend — attendance cannot be marked on a weekend.",
      noCalendarNote:
        "has no calendar entry. Generate the year's calendar first, then mark attendance.",
      correctionReason: "Reason for this correction",
      correctionReasonHelp:
        "Optional. Editing a past date — say why. Leaving it blank keeps any earlier note.",
      alreadyMarked: "Already marked today — submitting again updates the marks.",
      markedOne: "Attendance marked.",
      marked: (count: number) => `Attendance marked for ${count} students.`,
      readOnlyNote:
        "You can see this section's day but not mark it — marking needs the attendance:create permission.",
      statuses: {
        present: "Present",
        absent: "Absent",
        late: "Late",
        half_day: "Half day",
        on_leave: "On leave",
      },
    },
  },

  /** Chunk 8. `school.*` — the trust's branches. */
  branches: {
    title: "Branches",
    titleSingular: "School",
    subtitle: "The schools that belong to this trust.",
    add: "Add branch",
    addTitle: "Add a branch",
    editTitle: "Edit branch",
    emptyTitle: "No branches yet",
    emptyBody: "Add the first school in this trust to begin.",
    fields: {
      name: "Name",
      nameHelp: "What people call this school day to day.",
      legalName: "Registered name",
      legalNameHelp: "As it appears on official records.",
      code: "Code",
      codeHelp: "A short identifier, in capitals. Used on receipts and reports.",
      email: "Email",
      phone: "Phone",
      city: "City",
      state: "State",
      pincode: "Pincode",
      udiseCode: "UDISE code",
      udiseHelp: "11 digits, if this school has one.",
    },
    closeAction: "Close branch",
    closeTitle: "Close this branch?",
    closeBody:
      "Staff will no longer be able to work in it, and it disappears from the branch list. Nothing is deleted — students, payments and results stay exactly as they are.",
    closeConfirm: "Close branch",
    closed: "Branch closed. Records are kept.",
    created: "Branch added.",
    updated: "Branch updated.",
    /**
     * `board_type` values as schools say them. The enum stores lowercase keys;
     * nobody outside the database calls it "unaffiliated" without explanation.
     */
    boards: {
      cbse: "CBSE",
      icse: "ICSE",
      state: "State board",
      ib: "IB",
      unaffiliated: "Not affiliated yet",
    },
    boardLabel: "Board",
    boardHelp: "Which examination board this school follows.",
  },

  /** Chunk 9. `academic.year.*` — sessions. */
  sessions: {
    title: "Sessions",
    subtitle: "The academic years this school runs.",
    add: "Add session",
    addTitle: "Add a session",
    editTitle: "Edit session",
    emptyTitle: "No session yet",
    emptyBody:
      "A session is one academic year. Classes and sections hang off it, so this comes first.",
    /** The running session — never "active", which reads as "not deleted". */
    running: "Running session",
    runningHint: "This is what your colleagues see by default.",
    past: "Past sessions",
    fields: {
      startYear: "Which year does it start in?",
      startYearHelp:
        "Picking a year sets 1 April to 31 March and names the session for you.",
      name: "Name",
      nameHelp: "Usually the two years it spans, like 2025-26.",
      startDate: "Starts on",
      endDate: "Ends on",
      customDates: "Set the dates myself",
    },
    setCurrentAction: "Make this the running session",
    setCurrentTitle: "Make this the running session?",
    setCurrentBody:
      "Every colleague's default view changes to this session. The one running now becomes a past session. Nothing is deleted, and you can switch back.",
    setCurrentConfirm: "Make it the running session",
    setCurrent: "Running session changed.",
    created: "Session added.",
    updated: "Session updated.",
    /** Shown where a caller lacks academic_year:read_history. */
    historyHidden: "You can see the running session only.",
  },

  /** Chunk 10. `academic.class.*`. */
  classes: {
    title: "Classes",
    subtitle: "The classes this school teaches, in order.",
    add: "Add classes",
    addTitle: "Add classes",
    editTitle: "Edit class",
    emptyTitle: "No classes yet",
    emptyBody: "Pick the classes this school teaches. You can change them later.",
    /**
     * The ladder replaces a numeric-order field. `classes_school_order_uq` makes
     * that number a collision the user has no way to understand, and the order is
     * standard anyway.
     */
    ladderTitle: "Which classes does this school teach?",
    ladderHelp: "Tick every class you run. They are ordered for you.",
    /**
     * The Class 11 mistake, stated before it is made. Two "Class 11" rows collide
     * on both name and order, and the collision is only reported by the database.
     */
    streamNote:
      "Streams like Science and Commerce are sections inside Class 11, not separate classes. Add Class 11 once, then add a section for each stream.",
    fields: {
      name: "Name",
      nameHelp: "Whatever this school calls it — Class 6, Grade 6, Standard VI.",
      description: "Note",
      descriptionHelp: "Optional. Anything worth remembering about this class.",
    },
    closeAction: "Close class",
    closeTitle: "Close this class?",
    closeBody:
      "It stops appearing when you add sections or enrol students. Past sections, attendance and results stay exactly as they are.",
    closeConfirm: "Close class",
    closed: "Class closed. Records are kept.",
    created: "Classes added.",
    updated: "Class updated.",
    /** Reached by pasting or bookmarking a class id the caller cannot see. */
    notFoundTitle: "Class not available",
    notFoundBody:
      "This class is not in the branch you are working in, or you do not have access to it.",
    /** Bulk create is N calls, so partial success is a normal outcome. */
    bulkPartial: "Some classes were not added.",
    bulkRetryFailed: "Try the ones that failed again",
    bulkAdded: (added: number, total: number) => `Added ${added} of ${total} classes.`,
  },

  /** Chunk 11. `academic.section.*`, nested under a class. */
  sections: {
    title: "Sections",
    subtitle: "Sections in this class, for the session you are working in.",
    add: "Add sections",
    addTitle: "Add sections",
    editTitle: "Edit section",
    emptyTitle: "No sections yet",
    emptyBody: "Add a section — A, B, C — so students have somewhere to be enrolled.",
    namesHelp: "Add several at once: A, B, C.",
    fields: {
      name: "Name",
      nameHelp: "Usually a letter, but Morning or Day works too.",
      stream: "Stream",
      streamHelp: "Optional. Science, Commerce, Arts.",
      house: "House",
      roomNumber: "Room",
      maxStudents: "Seats",
      maxStudentsHelp: "Optional. The most students you will enrol here.",
    },
    /**
     * `academicYearId` and `classId` are not patchable, and the reason is worth
     * telling the user rather than hiding the control and leaving them puzzled.
     */
    cannotMove:
      "A section cannot be moved to another class or session — every student, attendance record and result attached to it would move too. Close it and create the section in the right place instead.",
    closeAction: "Close section",
    closeTitle: "Close this section?",
    closeBody:
      "Students can no longer be enrolled into it. Attendance and results already recorded stay exactly as they are.",
    closeConfirm: "Close section",
    closed: "Section closed. Records are kept.",
    created: "Sections added.",
    updated: "Section updated.",
    /** The one hard prerequisite: sections hang off a session. */
    needsSession: "Create a session first — sections belong to one academic year.",
    /** Bulk entry, the same shape as the class ladder. */
    bulkLabel: "Section names",
    bulkHelp: "One per line, or separated by commas: A, B, C.",
    bulkEmpty: "Type at least one name.",
    bulkPartial: "Some sections were not added.",
    bulkRetryFailed: "Try the ones that failed again",
    bulkAdded: (added: number, total: number) => `Added ${added} of ${total} sections.`,
    /** Shown on the class detail header. */
    inClass: (className: string) => `Sections in ${className}`,
  },

  /** Chunk 12. The first-run checklist on Home. */
  setup: {
    title: "Finish setting up",
    subtitle: "Three steps, in this order. Each one unlocks the next screen.",
    sessionStep: "Create this year's session",
    sessionStepWhy: "Sections and, later, fees and results all hang off a session.",
    classesStep: "Add your classes",
    classesStepWhy: "Nursery to Class 12 — tick the ones this school teaches.",
    sectionsStep: "Add sections",
    sectionsStepWhy: "A, B, C inside each class. Students are enrolled into these.",
    done: "Done",
    /** Only the sections step is genuinely blocked; classes are not year-scoped. */
    needsSession: "Create a session first.",
  },

  /** States the shell itself can be in, before any screen renders. */
  access: {
    noStaffAccessTitle: "No school access yet",
    noStaffAccessBody:
      "You are signed in, but your account has no role at any school. Ask your administrator to give you access.",
    loadFailedTitle: "Couldn't load your school",
    /** Shown when a write is attempted with no branch selected. */
    chooseBranchTitle: "Choose a branch first",
    chooseBranchBody: "This has to be saved against one branch. Pick one to continue.",
  },

  /** Read by `lib/errors.ts`. Nothing else should phrase a failure. */
  errors: {
    /** Title for a list that failed to load. The body comes from `lib/errors.ts`. */
    listFailedTitle: "Couldn't load this list",
    signedOut: "Your session expired. Please sign in again.",
    forbidden: "You don't have permission to do this. Ask your administrator.",
    notFound: "This record is no longer available. It may have been closed or moved.",
    invalid: "Some details need fixing. Check the highlighted fields and try again.",
    conflict: "That conflicts with something already saved. Check the details and try again.",
    network: "Couldn't reach the server. Check your connection and try again.",
    server: "Something went wrong on our side. Please try again.",
    tooMany: "Too many attempts. Wait a moment and try again.",
    unknown: "Something went wrong. Please try again.",
    /** Shown when a write arrives with no branch chosen. */
    needsBranch: "Choose a branch first — this has to be saved against one branch.",
    /** Rendered by the error boundaries (app/error.tsx and the nested one).
     *  The underlying failure is never shown; the digest line is for support. */
    boundaryTitle: "This page hit a problem.",
    boundaryBody: "Trying again usually fixes it. If it keeps happening, ask your administrator.",
    boundaryDigest: "Reference",
  },
} as const;

/**
 * "Branch" or "School", by how many the caller can see.
 *
 * A principal with one school should never read the word "branch"; it implies
 * others exist and that they are looking at a subset. A trust admin with four
 * needs exactly that implication.
 */
export function branchWord(schoolCount: number, plural = false): string {
  if (schoolCount > 1) {
    return plural ? copy.terms.branches : copy.terms.branch;
  }

  return plural ? copy.terms.schools : copy.terms.school;
}

/**
 * `1 class` / `4 classes`. English only, and English pluralisation is the one
 * part of this file a translation cannot reuse — which is why the caller passes
 * both forms instead of this function guessing a suffix.
 */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
