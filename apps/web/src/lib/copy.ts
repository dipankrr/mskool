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
    fees: "Fees",
    subjects: "Subjects",
    exams: "Exams",
    examSetup: "Exam Setup",
    termGrades: "Term grades",
    staff: "Staff",
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
    status: "Status",
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
    // The family tab (ADR-007): parents sign in by phone.
    familyTab: "Family",
    staffTab: "Staff",
    school: "School",
    schoolHelp: "Pick the school, then type the phone number it has for you.",
    phone: "Phone number",
    phoneHelp: "The 10-digit number you registered with the school.",
    familySubtitle: "Sign in with the phone number linked to your child.",
  },
  changePassword: {
    title: "Set a new password",
    subtitle: "Your school set a temporary password. Choose your own to finish signing in.",
    newPassword: "New password",
    confirm: "Re-enter the new password",
    mismatch: "The two passwords do not match.",
    submit: "Save password",
    saved: "Password saved.",
  },
  portalAccess: {
    title: "Family login",
    activate: "Activate family login",
    activated: "Family login activated. The family signs in with this phone number.",
    phone: "Phone number",
    phoneHelp: "The number the family will sign in with. They type the 10 digits; the school prefix is automatic.",
    initialPassword: "Initial password",
    initialPasswordHelp: "Temporary. The family must choose their own at first sign-in.",
    resetPassword: "Reset password",
    resetDone: "Password reset. Every open session was signed out; the family must change it at next sign-in.",
    resetHelp: "Re-issues a temporary password. You cannot see the old one — nobody can.",
    newPasswordLabel: "Temporary password",
    changePhone: "Change phone number",
    phoneChanged: "Phone number changed. Every open session was signed out.",
    changePhoneHelp: "The phone is the login itself. Changing it signs out every open session.",
    reason: "Reason",
    reasonPlaceholder: "e.g. Parent changed their number; verified at the office",
    reasonRequired: "Say why — the reason is recorded with your name.",
    newPhone: "New phone number",
    submit: "Save",
  },
  portal: {
    title: "Family portal",
    results: "Results",
    attendance: "Attendance",
    fees: "Fees",
    child: "Child",
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
    reportsLink: "Reports",
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
      markAllPresent: "All present",
      markAllAbsent: "All absent",
      tapHint: "Tap to change",
      statusShort: {
        present: "P",
        absent: "A",
        late: "L",
        half_day: "H",
        on_leave: "V",
      },
      statusCycle: {
        present: "Present",
        absent: "Absent",
        late: "Late",
        half_day: "Half day",
        on_leave: "On leave",
      },
      liveCount: (present: number, absent: number, other: number) => {
        const parts = [`${present} present`];
        if (absent > 0) parts.push(`${absent} absent`);
        if (other > 0) parts.push(`${other} other`);
        return parts.join(" · ");
      },
      doneTitle: "Attendance done",
      doneHelp: "Tap any student's status to correct it, then save again.",
      today: "Today",
      markedOne: "Attendance marked.",
      marked: (count: number) => `Attendance marked for ${count} students.`,
      holidayNote: "is a holiday — attendance cannot be marked on a holiday.",
      weekendNote: "is a weekend — attendance cannot be marked on a weekend.",
      noCalendarNote:
        "has no calendar entry. Generate the year's calendar first, then mark attendance.",
      correctionReason: "Reason for this correction",
      correctionReasonHelp:
        "Optional — only the students whose status CHANGES need a reason. Leaving it blank keeps any earlier note.",
      changedCount: (count: number) =>
        count === 1 ? "1 student changing — say why:" : `${count} students changing — say why:`,
      alreadyMarked: "Already marked today — submitting again updates the marks.",
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
    termsSection: "Terms",
    termsSubtitle: "The term plan for each session — exams, attendance summaries and fee installments all hang off these.",
    termsEmptyTitle: "No terms yet",
    termsEmptyBody: "Add the term plan — e.g. Term 1, Term 2 — before scheduling exams.",
    termAdd: "Add term",
    termEdit: "Edit term",
    termFields: {
      name: "Name",
      sequence: "Order",
      startDate: "Starts",
      endDate: "Ends",
    },
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
    termCreated: "Term added.",
    termUpdated: "Term updated.",
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
    curriculum: {
      title: "Curriculum",
      subtitle: "The subjects this class takes this year. The exam blueprint's coverage gate counts these rows.",
      subject: "Subject",
      subjectHelp: "Each subject maps once; a wrong mapping is unmapped and re-added, never re-pointed.",
      subjectType: "Result type",
      subjectTypeHelp: "Decides whether it counts toward the result, takes a grade instead of marks, and which card section it appears in.",
      mapSubject: "Map subject",
      mapped: "Subject mapped.",
      unmapAction: "Remove subject",
      unmapTitle: "Remove this subject from the class?",
      unmapBody:
        "It disappears from this class's pickers and the exam coverage check. Past exam papers and results keep pointing at the subject itself.",
      unmapConfirm: "Remove subject",
      unmapRefused: "The subject has term-grade entries — end those first.",
      elective: "Elective",
      emptyTitle: "No subjects mapped yet",
      emptyBody: "Map the subjects this class takes — exams, attendance periods and report cards all hang off these.",
      staffing: "Who teaches here",
      staffingSubtitle: "The section's open teaching assignments — the subject gate (ADR-029) reads exactly these rows.",
      staffingEmptyTitle: "No teaching assignments yet",
      staffingEmptyBody: "Assign the class teacher, then the subject teachers — marks entry checks these facts.",
      assign: "Assign teacher",
      assigned: "Teacher assigned.",
      teacher: "Teacher",
      role: "Role",
      roleHelp: "The class teacher has no subject; a subject teacher must have hers.",
      roles: {
        subject_teacher: "Subject teacher",
        class_teacher: "Class teacher",
      },
      section: "Section",
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

  /** The fees area: one vocabulary. Money is never "amount" alone — say which money. */
  fees: {
    subtitle: "Collections, outstanding fees and the fee setup for the session you are working in.",

    /** Tab labels — tasks, not database sections. */
    tabs: {
      overview: "Overview",
      collect: "Collect",
      outstanding: "Outstanding",
      payments: "Payments",
      ledger: "Ledger",
      setup: "Setup",
    },

    /** The Fees landing page. */
    overview: {
      title: "Fees",
      subtitle: "Monitor collections, outstanding fees and recent activity.",
      collected: "Collected",
      outstanding: "Outstanding",
      overdue: "Overdue",
      studentsWithDues: "Students with dues",
      collectAction: "Collect payment",
      outstandingTitle: "Outstanding",
      viewAll: "View all outstanding",
      recentTitle: "Recent payments",
      emptyOutstanding: "No outstanding fees",
      emptyOutstandingBody: "All students are up to date for this session.",
      emptyRecent: "No payments yet",
      emptyRecentBody: "The counter is where payments are recorded — the first one will appear here.",
    },

    /** Generic money-column headers. */
    amounts: {
      annual: "Annual",
      monthly: "Monthly",
      net: "Net",
      paid: "Paid",
      balance: "Balance",
      total: "Total",
      lateFee: "Late fee",
      concession: "Concession",
      refundable: "Refundable",
    },

    /** Enum → words, the lower-case wire value keyed. */
    headCategories: {
      regular: "Regular",
      one_time: "One-time",
      optional: "Optional service",
      fine: "Fine",
      refundable: "Refundable deposit",
    },
    installmentModes: {
      upfront: "Upfront",
      term_wise: "Term-wise",
      monthly: "Monthly",
    },
    frequencies: {
      inherit: "Same as structure",
      monthly: "Monthly",
      quarterly: "Quarterly",
      half_yearly: "Half-yearly",
      annual: "Annual",
      term_wise: "Term-wise",
    },
    lateFeeTypes: {
      flat: "Flat",
      percentage: "Percentage",
      per_day: "Per day",
    },
    concessionTypes: {
      sibling_discount: "Sibling discount",
      staff_ward: "Staff ward",
      merit_scholarship: "Merit scholarship",
      need_based: "Need-based",
      rte_waiver: "RTE waiver",
      management_discount: "Management discount",
      other: "Other",
    },
    concessionCalculations: { flat: "Flat ₹", percentage: "Percentage" },
    paymentModes: {
      cash: "Cash",
      upi: "UPI",
      cheque: "Cheque",
      neft_rtgs: "NEFT / RTGS",
      card: "Card",
      dd: "Demand draft",
    },
    paymentStatuses: {
      pending: "Pending confirmation",
      cleared: "Cleared",
      bounced: "Bounced",
      reversed: "Reversed",
      cancelled: "Cancelled",
    },
    installmentStatuses: {
      unpaid: "Unpaid",
      partial: "Partly paid",
      paid: "Paid",
      waived: "Waived",
      cancelled: "Cancelled",
    },
    subscriptionStatuses: {
      active: "Active",
      cancelled: "Cancelled",
      suspended: "Suspended",
    },
    assignmentStatuses: {
      active: "Active",
      suspended: "Suspended",
      cancelled: "Cancelled",
    },
    openingBalanceStatuses: {
      unpaid: "Unpaid",
      partial: "Partly paid",
      paid: "Paid",
      waived: "Waived",
    },
    ledgerTypes: {
      fee_payment: "Fee payment",
      fee_refund: "Refund",
      late_fee_charged: "Late fee",
      concession_applied: "Concession",
      waiver_applied: "Waiver",
      opening_balance: "Opening balance",
      opening_balance_payment: "Opening balance payment",
      advance_payment: "Advance payment",
      cheque_bounce_charge: "Cheque bounce charge",
      security_deposit_received: "Security deposit received",
      security_deposit_refunded: "Security deposit refunded",
    },
    ledgerDirections: { credit: "In", debit: "Out" },

    // ---- Setup: fee heads ----
    heads: {
      title: "Fee heads",
      subtitle:
        "What this school charges: tuition, transport, exam fees. Structures and every student's bill are built from these.",
      add: "Add fee head",
      addTitle: "Add a fee head",
      editTitle: "Edit fee head",
      emptyTitle: "No fee heads yet",
      emptyBody:
        "Add the first fee head — e.g. Tuition Fee — and the school's fee structures can be built from it.",
      created: "Fee head added.",
      updated: "Fee head updated.",
      fields: {
        name: "Name",
        nameHelp: "What it is called on bills and receipts.",
        shortCode: "Short code",
        shortCodeHelp: "Optional. A short label for reports, like TUIF.",
        description: "Note",
        category: "Category",
        categoryHelp:
          "Optional services (transport, hostel) can be subscribed to per student; one-time fees appear once a year.",
        isTaxable: "Taxable",
        isTaxableHelp: "Tick if GST applies to this head.",
        taxPercentage: "Tax %",
        taxPercentageHelp: "The GST rate for this head, like 18.",
      },
      retireAction: "Retire head",
      retireTitle: "Retire this fee head?",
      retireBody:
        "It stops appearing when you build fee structures. Existing structures, bills and receipts keep it exactly as they are. Records are kept.",
      retireConfirm: "Retire head",
      retired: "Fee head retired. Records are kept.",
    },

    // ---- Setup: structures ----
    structures: {
      title: "Fee structures",
      subtitle:
        "One structure per class per session: the heads it includes and how they split into instalments.",
      add: "Add structure",
      addTitle: "Add a fee structure",
      editTitle: "Edit structure",
      emptyTitle: "No structure for this class yet",
      emptyBody:
        "A structure is what a class is billed. Add one and students in the class can be assigned to it.",
      created: "Fee structure added.",
      updated: "Fee structure updated.",
      fields: {
        academicYear: "Session",
        academicYearHelp: "The session this structure bills for.",
        class: "Class",
        classHelp: "One structure per class per session.",
        name: "Name",
        nameHelp: "Usually the class and session, like Class 6 — 2025-26.",
        installmentMode: "Default instalment plan",
        installmentModeHelp:
          "The default way heads split across the session. A head can override this in its line.",
      },
      closeAction: "Close structure",
      closeTitle: "Close this structure?",
      closeBody:
        "New students cannot be assigned to it. Students already assigned keep their bills — their assignment froze the amounts at assignment time. Records are kept.",
      closeConfirm: "Close structure",
      closed: "Structure closed. Records are kept.",
      linesTitle: "Fee lines",
      linesSubtitle: "The heads this structure bills, and how each splits.",
      addLine: "Add line",
      emptyLinesTitle: "No lines yet",
      emptyLinesBody: "Add a fee head and an annual amount — this is what the class gets billed.",
      lineFields: {
        head: "Fee head",
        headHelp: "The charge this line bills.",
        annualAmount: "Annual amount",
        annualAmountHelp: "The full-session charge for this head.",
        frequency: "Instalment frequency",
        frequencyHelp: "How this head splits across the session.",
        fromMonth: "From month",
        toMonth: "To month",
        windowHeader: "Applies",
        wholeSession: "Whole session",
        linePreview: (per: string, count: number) => `${per} × ${count} instalments`,
        monthsHelp: "The part of the session this head applies to — usually the whole session.",
      },
      lineCreated: "Fee line added.",
      lineUpdated: "Fee line updated.",
      lateFeeTitle: "Late fee rules",
      lateFeeSubtitle:
        "What gets charged when a payment is late. Rules are added as they take effect; there is no edit — set an end date on the old rule and add a new one.",
      addLateFeeRule: "Add late fee rule",
      lateFeeFields: {
        graceDays: "Grace days",
        graceDaysHelp: "Days after the due date before late fee starts.",
        type: "Charges",
        value: "Value",
        valueHelp: "Flat rupees, a percentage of the instalment, or rupees per day.",
        perDaySuffix: "/ day",
        max: "Cap",
        maxHelp: "Optional. The most this rule can charge on one instalment.",
        from: "Effective from",
        to: "Effective until",
        windowHelp: "The dates this rule applies between. Leave the end open to run until changed.",
      },
      lateFeeCreated: "Late fee rule added.",
    },

    // ---- Student fee profile ----
    profile: {
      title: "Fees",
      subtitle: "This student's fee bill for the session: structure, concessions, and instalments.",
      notAssignedTitle: "No fee structure assigned",
      notAssignedBody:
        "Assign the class's structure and this student's instalments can be generated.",
      assignAction: "Assign structure",
      assignTitle: "Assign the fee structure",
      assignHelp:
        "The class's active structure is found for you; its amounts are frozen onto the assignment so later structure edits do not rewrite this student's bill.",
      assigned: "Fee structure assigned.",
      fields: {
        enrollment: "Enrollment",
        enrollmentHelp: "The class and session the fee bill is for.",
        effectiveFrom: "Fees start on",
        effectiveFromHelp: "Usually the session start. Later dates cut earlier months off the bill.",
        fullJoiningMonth: "Charge the joining month in full",
        fullJoiningMonthHelp:
          "Off when a student joins mid-month and should pay only the remaining days.",
      },
      baseAnnual: "Annual before concessions",
      netAnnual: "Annual after concessions",
      billedTotal: "Total billed",
      concessionsTotal: "Concessions",
      paidTotal: "Paid",
      outstandingTotal: "Outstanding",
      recentPayments: "Recent payments",
      collectAction: "Collect payment",
      viewAllPayments: "View all payments",
      generate: "Generate instalments",
      generateHelp:
        "Creates the session's instalment rows from the structure. Safe to run again — it fills gaps only, never rewrites existing rows.",
      generated: (count: number) =>
        count === 1
          ? "1 instalment generated."
          : `${count} instalments generated.`,
      nothingToGenerate: "Instalments are up to date — nothing new to generate.",
      concession: "Add concession",
      concessionTitle: "Add a concession",
      concessionHelp:
        "The amount is worked out and applied by the school's server — you record the type and the value, never the resulting rupees.",
      concessionCreated: (amount: string) => `Concession applied — ${amount} off the annual bill.`,
      concessionFields: {
        type: "Type",
        calculation: "Applies as",
        value: "Value",
        valueHelp: "Rupees when flat, percent when percentage. Percentages round in the school's favour.",
        head: "Applies to head",
        headHelp: "Leave on All heads to apply across the bill.",
        allHeads: "All heads",
        reason: "Reason",
        reasonHelp: "Optional note for the record.",
        from: "Valid from",
        to: "Valid until",
        windowHelp: "The part of the session this concession applies to.",
      },
      recompute: "Recompute concessions",
      recomputeHelp:
        "Re-applies concessions onto instalments that have never been paid. Anything partly or fully paid keeps its history — money already received is not renegotiated.",
      recomputed: "Concessions re-applied.",
      installmentsTitle: "Instalments",
      installmentsSubtitle: "What this student owes, head by head.",
      moreOpen: (count: number) => `+${count} more open`,
      noInstallmentsTitle: "No instalments yet",
      noInstallmentsBody: "Generate them — they are built from the structure frozen at assignment.",
    },

    // ---- Optional subscriptions ----
    subscriptions: {
      title: "Optional services",
      subtitle: "Per-student services priced outside the structure — transport, hostel, and similar.",
      add: "Subscribe",
      addTitle: "Subscribe to an optional service",
      emptyTitle: "No optional services",
      emptyBody: "Subscribe a student to transport or another optional head and it joins their bill.",
      created: "Subscription added. Generate instalments to bill it.",
      fields: {
        head: "Service",
        headHelp: "Only optional-category heads can be subscribed to.",
        detail: "Service detail",
        detailHelp: "Optional. e.g. Route 3 — Dum Dum.",
        monthly: "Monthly amount",
        annual: "Annual amount",
        from: "Subscribed from",
        to: "Subscribed until",
        windowHelp: "The months this service is billed for.",
      },
      cancelAction: "Cancel subscription",
      cancelTitle: "Cancel this subscription?",
      cancelBody:
        "No new instalments are generated for it. Ones already billed stay on the student's record. Records are kept.",
      cancelConfirm: "Cancel subscription",
      cancelled: "Subscription cancelled. Records are kept.",
    },

    // ---- Dues ----
    dues: {
      title: "Outstanding fees",
      subtitle: "Students with unpaid or partially paid fees for this session.",
      emptyTitle: "No outstanding fees",
      emptyBody: "All students are up to date for this session.",
      filterSession: "Session",
      filterStudent: "Student",
      filterAllStudents: "All students",
      filterStatus: "Status",
      filterAllStatuses: "All statuses",
      statusOverdue: "Overdue",
      statusDue: "Due",
      searchLabel: "Search",
      searchPlaceholder: "Search student…",
      dueBy: "Due by",
      dueByHelp: "Show only instalments due on or before this date.",
      grandTotal: "Total outstanding",
      overdueTotal: "Overdue",
      overdue: "Overdue",
      studentHeader: "Student",
      statusHeader: "Status",
      studentsWithDues: "Students with dues",
      studentsWithDuesCount: (count: number) =>
        count === 1 ? "1 student with dues" : `${count} students with dues`,
      studentsOverdue: "Students overdue",
      studentsOverdueCount: (count: number) =>
        count === 1 ? "1 student overdue" : `${count} students overdue`,
      oldestDue: "Oldest due",
      collectAction: "Collect",
      viewAccount: "View account",
      owedBy: (name: string, total: string) => `${name} owes ${total}`,
      waiveAction: "Waive",
      waiveTitle: "Waive this instalment?",
      waiveBody:
        "The instalment is marked waived and the amount stops being owed. Only an instalment that has never been paid can be waived — money already received must be refunded instead. Records are kept.",
      waiveConfirm: "Waive instalment",
      waived: "Instalment waived. Records are kept.",
      historyNote: "You are viewing a past session.",
    },

    // ---- Counter ----
    counter: {
      title: "Collect payment",
      subtitle: "Search, amount, method, receipt — the desk workflow.",
      searchLabel: "Search student",
      searchPlaceholder: "Name or admission number…",
      searchHelp: "Type a name or admission number, pick the student, and their balance appears.",
      noResultsTitle: "No student found",
      noResultsBody: "Check the spelling or admission number and try again.",
      selected: "Collecting for",
      openCount: (count: number) =>
        count === 1 ? "1 open instalment" : `${count} open instalments`,
      noOpenTitle: "Nothing to collect",
      noOpenBody:
        "This student has no instalments with a balance for this session. If you expected dues, check the session switcher.",
      amountReceived: "Amount received",
      invalidAmount: "Fix the highlighted amounts — use numbers like 1250.00.",
      collectFull: (total: string) => `Collect full balance · ${total}`,
      autoAppliedTitle: "Applied automatically",
      autoAppliedHelp:
        "Your payment is applied to the oldest outstanding instalments first.",
      changeAllocation: "Change allocation",
      hideAllocation: "Hide allocation",
      allocatedOf: (allocated: string, total: string) => `Allocated ${allocated} / ${total}`,
      unallocated: (left: string) => `${left} unallocated — it stays uncollected.`,
      amount: "Amount",
      payFull: "Pay in full",
      clear: "Clear",
      total: "Payment total",
      lateFeeNote:
        "If a late fee applies, the school's server works it out and it appears on the receipt — it is never typed here.",
      mode: "Payment method",
      modeHelp: "Cash is confirmed immediately. Everything else waits for the bank — it shows as pending until confirmed.",
      paymentDate: "Paid on",
      transactionRef: "Reference",
      transactionRefHelp: "UPI reference, cheque number, or UTR.",
      transactionRefCheque: "Cheque no.",
      transactionRefDd: "DD no.",
      transactionRefElectronic: "UPI ref / UTR",
      bankName: "Bank",
      chequeDate: "Cheque date",
      chequeDateHelp: "The date on the cheque, if it is post-dated.",
      remarks: "Remarks",
      remarksHelp: "Optional note for the receipt.",
      submit: "Record payment",
      submitAmount: (total: string) => `Record ${total} payment`,
      enterAmount: "Enter an amount to continue",
      submitting: "Recording…",
      recorded: (receipt: string) => `Payment recorded — receipt ${receipt}.`,
      pendingNote:
        "Recorded and awaiting confirmation — it shows as pending until a confirmer clears it.",
      confirmationTitle: "Payment recorded",
      collectAnother: "Collect another payment",
      viewReceipt: "View receipt",
      receiptTitle: "Receipt",
      receiptBranch: "Branch",
      receiptStudent: "Student",
      nextStudent: "Next student",
      print: "Print receipt",
    },

    // ---- Payments ----
    payments: {
      title: "Payments",
      subtitle: "Every payment recorded this session, its status, and the actions it still allows.",
      emptyTitle: "No payments yet",
      emptyBody: "The counter is where payments are recorded — the first one will appear here.",
      filterMethod: "Method",
      filterAllMethods: "All methods",
      receipt: "Receipt",
      detailTitle: "Payment",
      allocationsTitle: "Applied to",
      statusTimelineTitle: "History",
      statusBy: "by",
      statusReason: "Reason",
      collectedBy: "Collected by",
      clearAction: "Clear",
      clearTitle: "Mark this payment cleared?",
      clearBody:
        "Confirms the money arrived. The instalments it paid stay paid. This is the confirmation a pending payment waits for.",
      bounceAction: "Bounce",
      bounceTitle: "Mark this payment bounced?",
      bounceBody:
        "For a cheque that was returned or a transfer that failed. The instalments it covered go back to being owed, and a bounce charge is recorded in the ledger. Records are kept.",
      reverseAction: "Reverse",
      reverseTitle: "Reverse this payment?",
      reverseBody:
        "Takes the payment back off the student's bill — the instalments it covered become owed again, and a reversal is recorded in the ledger. Records are kept.",
      cancelAction: "Cancel",
      cancelTitle: "Cancel this payment?",
      cancelBody:
        "For a payment recorded by mistake that never moved money. The instalments it covered go back to being owed. Nothing is deleted — the cancellation stays on the record.",
      refundAction: "Refund",
      refundTitle: "Record a refund",
      refundBody:
        "Money going back for a payment that cleared. The refund re-opens what it covered, oldest instalment first.",
      reasonLabel: "Reason",
      reasonHelp: "Said on the record — required.",
      transitioned: (action: string) => `Payment ${action}. Records are kept.`,
      refundFields: {
        amount: "Refund amount",
        date: "Refunded on",
        mode: "Refund by",
        reference: "Reference",
        referenceHelp: "Optional. UTR, cheque number, or UPI reference.",
      },
      refunded: "Refund recorded. Records are kept.",
      terminalNote: "This payment has reached the end of its lifecycle — no further actions.",
    },

    // ---- Ledger ----
    ledger: {
      title: "Ledger",
      subtitle:
        "Every money movement, appended as it happened. Nothing here is ever edited — corrections are new rows.",
      emptyTitle: "No entries yet",
      emptyBody: "The ledger fills as payments, concessions, waivers and refunds happen.",
      filterType: "Type",
      filterAllTypes: "All types",
      moneyIn: "Money in",
      moneyOut: "Money out",
      netTotal: "Net",
      runningBalance: "Running balance",
      taxNote: "Taxable",
    },

    // ---- Opening balances (student profile section) ----
    openingBalances: {
      title: "Opening balances",
      subtitle: "Previous-session dues carried into this one.",
      add: "Record opening balance",
      addTitle: "Record an opening balance",
      addHelp:
        "Carries a past session's dues into the current one so they can be collected here. The origin session must differ from the one it lands in.",
      emptyTitle: "No opening balance",
      emptyBody: "Nothing was carried into this session for this student.",
      created: "Opening balance recorded.",
      fields: {
        session: "Lands in session",
        origin: "Dues from session",
        originHelp: "The session the dues belong to.",
        amount: "Amount",
        description: "Note",
      },
    },
  },

  /** States the shell itself can be in, before any screen renders. */
  access: {
    noStaffAccessTitle: "No school access yet",
    noStaffAccessBody:
      "You are signed in, but your account has no role at any school. Ask your administrator to give you access.",
    /** The family login's version of the same state — it HAS a portal, staff does not. */
    portalOnlyTitle: "You are signed in as a family",
    portalOnlyBody:
      "This is the staff console. Your results, attendance and fees live in the family portal.",
    loadFailedTitle: "Couldn't load your school",
    /** Shown when a write is attempted with no branch selected. */
    chooseBranchTitle: "Choose a branch first",
    chooseBranchBody: "This has to be saved against one branch. Pick one to continue.",
  },

  /** The employment register and its roles (ADR-035). */
  staff: {
    subtitle:
      "The staff register — every employee of this branch, searchable by name or employee code.",
    add: "Add staff",
    addTitle: "Add a staff member",
    addHelp:
      "The employment record only. A login is created separately, from the staff member's own page — the credential is a distinct, audited act (ADR-035).",
    created: "Staff member added.",
    updated: "Details saved.",
    deactivated: "Record deactivated.",
    searchLabel: "Search staff",
    searchPlaceholder: "Search by name or employee code…",
    noResultsTitle: "Nobody matches",
    noResultsBody: "Try another name or a different employee code.",
    emptyTitle: "No staff yet",
    emptyBody:
      "Add the first employee to start the register. Roles and logins are granted from here too.",
    showInactive: "Show former staff",
    fields: {
      employeeCode: "Employee code",
      employeeCodeHelp: "School-issued and permanent. The login name is derived from it.",
      firstName: "First name",
      middleName: "Middle name",
      lastName: "Last name",
      gender: "Gender",
      dateOfBirth: "Date of birth",
      phone: "Phone",
      email: "Email",
      designation: "Designation",
      department: "Department",
      qualification: "Qualification",
      dateOfJoining: "Date of joining",
      dateOfLeaving: "Date of leaving",
    },
    statuses: {
      active: "Active",
      on_leave: "On leave",
      suspended: "Suspended",
      resigned: "Resigned",
      retired: "Retired",
      terminated: "Terminated",
    },
    deactivateTitle: "End this employment?",
    deactivateBody:
      "The record is not deleted — it stays as history, and past attendance and marks keep pointing here. Role assignments are not removed automatically; revoke them separately if the person must lose access.",
    deactivateLabel: "Deactivate",
    leavingStatus: "How does the employment end?",
    leavingStatusHelp:
      "A suspension is temporary, so no leaving date is recorded. The others stamp today as the date of leaving.",
    loginTitle: "Console login",
    loginNone:
      "No login yet. Creating one issues an initial password you hand over in person — the staff member must change it at first sign-in.",
    loginActive:
      "Login active. The staff member manages their own password; you can reset it if it is lost.",
    loginCreate: "Create login",
    loginReset: "Reset password",
    loginCreateTitle: "Create the console login",
    loginCreateHelp:
      "Set an initial password to hand over. At first sign-in the staff member must change it — after that, only they know it.",
    loginResetTitle: "Reset the password",
    loginResetHelp:
      "Set a new initial password to hand over. Every live session is signed out, and the forced change applies again at the next sign-in.",
    password: "Initial password",
    passwordHelp: "At least 8 characters. Read it out or hand it over — do not send it in writing.",
    loginCreated:
      "Login created. Hand over the password — the forced change applies at first sign-in.",
    loginResetDone: "Password reset. Live sessions were signed out.",
    rolesTitle: "Roles",
    rolesEmpty: "No roles granted. A staff member without a role cannot do anything in the console.",
    roleAssign: "Assign role",
    roleAssignTitle: "Assign a role",
    roleAssignHelp:
      "A role answers 'what may this person do'; the scope answers 'where'. A principal at one branch does not gain anything at another.",
    roleGranted: "Role granted.",
    roleRevoked: "Role revoked.",
    role: "Role",
    scope: "Scope",
    scopeOrg: "Whole organisation",
    scopeSchool: "A branch",
    scopeBranchLabel: "Branch",
    expires: "Expires (optional)",
    expiresHelp: "For temporary cover — an expired grant stops working on its own.",
    revoke: "Revoke",
    revokeTitle: "Revoke this role?",
    revokeReason: "Why is this access being removed?",
    revokeHelp: "The reason is recorded in the audit log, together with who revoked what and when.",
    matrixTitle: "What each role may do",
    matrixHelp: "The organisation's permission matrix, read-only. The person's roles are marked.",
    editorEdit: "Edit",
    editorTitle: "Edit permissions",
    editorHelp:
      "Tick what this role may do. Saving applies the change to EVERY holder of the role, immediately — it is recorded in the audit log.",
    editorSearch: "Filter permissions",
    editorSearchPlaceholder: "Search a resource or action…",
    editorEmpty: "Nothing matches this filter.",
    editorDirty: (added: number, removed: number) =>
      `${added} to grant · ${removed} to withdraw`,
    editorSave: "Save changes",
    editorDiscard: "Discard",
    editorReset: "Reset to defaults",
    editorResetTitle: "Restore the shipped defaults?",
    editorResetBody: (changes: number) =>
      `${changes} permission${changes === 1 ? "" : "s"} will change for every holder of this role, immediately. This is how an admin gets back to a known-good matrix.`,
    editorConfirmTitle: "Apply these permission changes?",
    editorConfirmBody: (added: number, removed: number) =>
      `Every holder of this role gains ${added} and loses ${removed} permission${added + removed === 1 ? "" : "s"}, immediately. The change is recorded in the audit log.`,
    editorSaved: (added: number, removed: number) =>
      `Saved — ${added} granted, ${removed} withdrawn.`,
    editorResetDone: "Restored to the shipped defaults.",
    editorLockedBootstrap: "The bootstrap role — it cannot be edited, by anyone.",
    editorModified: "Modified",
    editorNoChanges: "No changes to save.",
    categories: {
      Academic: "Academic",
      Finance: "Fees",
      Staff: "Staff & leave",
      Communication: "Announcements",
      Structure: "Branches & classes",
      Configuration: "Configuration",
      Auth: "Access & roles",
    },
    roles: {
      org_admin: "Organisation admin",
      principal: "Principal",
      vice_principal: "Vice principal",
      class_teacher: "Class teacher",
      subject_teacher: "Subject teacher",
      accountant: "Accountant",
      librarian: "Librarian",
      staff_coordinator: "Staff coordinator",
    },
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

  exams: {
    setup: {
      title: "Exam Setup",
      subtitle: "Subject types, grading scales, and pass rules — everything an exam reads before it exists.",
      tabs: { types: "Subject Types", scales: "Grading Scales", criteria: "Pass Criteria" },
    },
    subjects: {
      title: "Subjects",
      subtitle: "The school's subject catalogue — shared by timetables, exams, and report cards.",
      add: "Add subject",
      edit: "Edit subject",
      created: "Subject created.",
      updated: "Subject updated.",
      retired: "Subject deactivated.",
      retireAction: "Deactivate subject",
      retireTitle: "Deactivate this subject?",
      retireBody: "History keeps pointing at it — it just disappears from new pickers.",
      retireConfirm: "Deactivate",
      emptyTitle: "No subjects yet",
      emptyBody: "Add the subjects this school teaches — Maths, Hindi, Art — before wiring them to classes.",
      fields: { name: "Name", shortName: "Short name", code: "Code" },
    },
    types: {
      title: "Subject Types",
      subtitle: "What each kind of subject is for: whether it counts toward the result, how it is entered, and where it renders on the report card.",
      add: "Add type",
      applyPreset: "Apply standard preset",
      presetApplied: "Standard preset applied.",
      created: "Subject type created.",
      updated: "Subject type updated.",
      retired: "Subject type deactivated.",
      retireAction: "Deactivate type",
      retireTitle: "Deactivate this subject type?",
      retireBody: "Existing class mappings keep pointing at it; it just disappears from new pickers.",
      retireConfirm: "Deactivate",
      emptyTitle: "No subject types yet",
      emptyBody: "Types group subjects on the report card and decide how they are graded. Try the standard preset, or add your own.",
      lockedNote: "This type has assessment data — its grading behaviour is locked. Assign a different type to the class instead.",
      lockedBadge: "Locked — in use",
      fields: {
        name: "Name",
        counts: "Counts toward result",
        countsHelp: "Excluded subjects still appear on the card but never touch totals or pass/fail.",
        graded: "Grade only",
        gradedHelp: "Grade-only subjects take a letter grade instead of marks.",
        mode: "Assessed by",
        sequence: "Card order",
      },
      badges: { exam: "Exam", term_grade: "Term grade" },
    },
    scales: {
      title: "Grading Scales",
      subtitle: "Percentage bands that turn a score into a grade. A scale locks the first time a result uses it — create a new one to change policy.",
      add: "Add scale",
      created: "Grading scale created.",
      updated: "Grading scale updated.",
      bandsReplaced: "Bands replaced.",
      emptyTitle: "No grading scales yet",
      emptyBody: "Add a scale — e.g. 91-100 A1 — so computed results can show grades.",
      locked: "Locked — in use",
      isDefault: "Default",
      makeDefault: "Set as default",
      madeDefault: "Default scale switched.",
      deactivateScale: "Deactivate scale",
      deactivateScaleTitle: "Deactivate this scale?",
      deactivateScaleBody:
        "New results stop offering it. Past results keep grading as they did. Locked scales refuse — create a new one instead.",
      fields: {
        name: "Name",
        description: "Description",
        isDefault: "School default",
        bands: "Bands (percentage, contiguous 0-100)",
        gradeLabel: "Grade",
        minMarks: "From %",
        maxMarks: "To %",
        gradePoint: "Grade point",
        descriptor: "Descriptor",
      },
      addBand: "Add band",
    },
    results: {
      title: "Results",
      subtitle: "Computed marks are photographs — compute again after any entry changes.",
      classPicker: "Class",
      compute: "Compute results",
      computed: "Results computed.",
      computeRanks: "Compute ranks",
      ranksComputed: "Ranks computed.",
      rank: "Rank",
      student: "Student",
      total: "Total",
      percent: "%",
      grade: "Grade",
      state: "Result",
      passed: "Pass",
      failed: "Fail",
      absent: "Absent",
      exempt: "Exempt",
      notCounted: "Not counted",
      statusDraft: "Draft",
      statusPublished: "Published",
      statsTitle: "Class statistics",
      average: "Average",
      highest: "Highest",
      passCount: "Passed",
      classAverage: "Class average",
      notComputed: "No results yet — compute to fill this table.",
      tableTitle: "Class results",
      publishCard: "Publication",
      publishedOn: "Published",
      revisionOpen: "Correction window open",
      windowClosed: "Window closed",
      openWindow: "Open correction window",
      closeWindow: "Close correction window",
      windowOpenTitle: "Open a correction window?",
      windowOpenConsequence:
        "Marks can then be corrected through the ledger — every change is recorded. Closing the window re-issues the affected cards.",
      windowCloseTitle: "Close the correction window?",
      windowCloseConsequence:
        "The engine recomputes and re-issues only the cards whose data actually changed.",
      cardHistory: "Card history",
      cardVersionsTitle: "Report card versions",
      correct: "Correct",
      correctionApplied: "Correction recorded — the card re-issues when the window closes.",
      correctionTitle: "Correct this entry?",
      correctionConsequence:
        "A ledger row records the change with your name; the card re-issues when the window closes.",
      entry: "Entry",
      revisedMarks: "Revised marks",
      revisedGrade: "Revised grade",
      revisedGradePlaceholder: "Only for grade papers — leave blank otherwise",
      currentMarks: "Current",
    },
    card: {
      annualTerm: "Annual Report",
      roll: "Roll",
      subject: "Subject",
      marks: "Marks",
      grade: "Grade",
      summary: "Summary",
      rankInClass: "Rank in class",
      rankInSection: "Rank in section",
      attendance: "Attendance",
      areas: "Areas & remarks",
      printSet: "Print class set",
      printCount: (count: number) =>
        count === 1 ? "1 card in this set." : `${count} cards in this set.`,
      invalidCount: (count: number) =>
        count === 1
          ? "1 card could not be read and is missing below — contact the school office."
          : `${count} cards could not be read and are missing below — contact the school office.`,
      issuedNote: "A frozen record of what was published — corrected cards re-issue as a new version.",
    },
    portal: {
      title: "Results",
      subtitle: "Only published results appear here — the school decides when you see them.",
      childPicker: "Child",
      print: "Print",
      emptyTitle: "No results published yet",
      emptyBody: "When the school publishes results, they appear here — complete, official, and printable.",
      loadFailed: "This card could not be loaded.",
    },
    reports: {
      title: "Attendance Reports",
      subtitle: "The term and yearly attendance percentages the eligibility checks read.",
      section: "Section",
      period: "Period",
      termRow: "Term",
      workingDays: "Working days",
      present: "Present",
      absent: "Absent",
      late: "Late",
      percent: "%",
      annual: "Full year",
      emptyTitle: "No attendance summaries yet",
      emptyBody: "Summaries appear as attendance is marked through the term.",
    },
    grades: {
      title: "Term grades",
      subtitle:
        "For subjects assessed without a paper — grade and remarks at term end. Saved as you go, like the marks grid.",
      class: "Class",
      section: "Section",
      term: "Term",
      subject: "Subject",
      roll: "Roll",
      student: "Student",
      grade: "Grade",
      gradePlaceholder: "e.g. A",
      remarks: "Remarks",
      saved: "Saved",
      pickSubjectFirst: "This class has no term-grade subjects mapped — map one in the class's curriculum (its result type is assessed by \"Term grade\").",
      readOnly: "Saving needs the marks:create permission — you're typing into read-only fields.",
      noSection: "This class has no sections yet — add one first.",
      emptyRoster: "No students in this section yet.",
    },
    entry: {
      title: "Marks entry",
      subtitle: "One paper at a time. Marks save as you go — the cell says when it has landed.",
      paper: "Paper",
      section: "Section",
      pickSectionFirst: "Choose your section above before entering marks — it is what authorizes the save.",
      readOnlyNotAssigned: "Marks entry for this paper is for its assigned subject teacher — you're viewing read-only.",
      readOnlyNoPermission: "Entering marks needs the marks:create permission — you're viewing read-only.",
      roll: "Roll",
      student: "Student",
      max: "Max",
      pass: "Pass",
      saving: "Saving…",
      saved: "Saved",
      conflict: "Someone else saved this cell — reopen the page, then retype.",
      refused: "Not saved — see the message.",
      gradePlaceholder: "Grade",
      gradeHelp: "This paper takes grades, not marks.",
      absent: "Absent",
      exempt: "Exempt",
      exemptType: "Exemption type",
      exemptionTypes: {
        medical: "Medical",
        disability: "Disability",
        board_approved: "Board approved",
        other: "Other",
      },
      clear: "Clear",
      verify: "Verify entered marks",
      verifyTitle: "Verify these entries?",
      verifyConsequence:
        "Verified entries lock against editing. The verification is recorded with your name.",
      verifiedToast: (count: number) =>
        count === 1 ? "1 entry verified." : `${count} entries verified.`,
      verifiedBadge: "Verified",
      enteredBadge: "Entered",
      draftBadge: "Draft",
      eligibilityBadge: "Below attendance bar — advisory",
      notOpen: "Marks entry is not open for this exam yet.",
      noBlueprint:
        "No papers scheduled yet — add the exam's subject schedules first, then come back to enter marks.",
      readOnly: "Read-only — you can look, but not type.",
      emptyRoster: "No students in this paper's section yet.",
    },
    workflow: {
      title: "Exams",
      add: "Add exam",
      created: "Exam created.",
      updated: "Exam updated.",
      transitioned: "Exam state changed.",
      schedulesSaved: "Schedule saved.",
      componentsSaved: "Components saved.",
      term: "Term",
      type: "Type",
      typeRegular: "Regular",
      typeSupplementary: "Supplementary",
      typeImprovement: "Improvement",
      typeMock: "Mock",
      typeTest: "Test",
      weightage: "Weight in term (%)",
      weightageHelp: "How much this exam counts toward the term. Counting exams of a term should sum to 100.",
      countsToward: "Counts toward the term result",
      countsTowardHelp: "Off for practice papers — they run the full pipeline and count for nothing.",
      nonCountingNote: "Mock and test papers always run but never count toward the term.",
      linkedExam: "Redeems exam",
      linkedExamHelp: "The earlier exam this paper gives a second chance at.",
      status: "Status",
      progress: "Published",
      publishedSuffix: "classes published",
      noTermsTitle: "No terms yet",
      noTermsBody: "Create the session's terms first — every exam hangs off a term.",
      emptyTitle: "No exams yet",
      emptyBody: "Create the term's exam, schedule its subjects, and enter marks.",
      editExam: "Edit exam",
      editExamHelp: "The exam's own details. Term and type are fixed — they are what the results hang off.",
      nameLabel: "Name",
      negativeMarking: "Allows negative marking",
      negativeMarkingHelp:
        "On: papers may deduct marks per wrong answer (set per part) and the grid accepts negative entries.",
      papersSection: "Papers",
      papersSubtitle:
        "Which class writes which subject, when. New classes start with every subject they teach — edit what differs.",
      papersEmptyBody:
        "No classes yet. Add one — its papers are created from the subjects it teaches.",
      allSections: "Whole class",
      lockedBadge: "Frozen",
      editScheduleFor: "Edit papers",
      addScheduleRow: "Add subject",
      removeRow: "Remove",
      addClasses: "Add classes",
      addClassesTitle: "Add classes to this exam",
      addClassesDescription:
        "Papers are created for each class's subjects with placeholder dates and one full-mark part — adjust anything afterwards.",
      addClassesEmpty: "Every class in the branch is already in this exam.",
      addClassesNone: "No classes selected.",
      addClassesAdded: (classes: number, papers: number) =>
        `${classes} ${classes === 1 ? "class" : "classes"} added · ${papers} ${
          papers === 1 ? "paper" : "papers"
        } created from the class subjects.`,
      removeClass: "Remove class",
      removeClassTitle: "Remove this class from the exam?",
      removeClassConsequence:
        "Its papers and their parts are deleted. This is only possible before marks entry opens.",
      removeClassConfirm: "Remove class",
      conflictWith: (subject: string) => `Overlaps ${subject}`,
      moreActions: "More actions",
      saveChanges: "Save changes",
      saveBlocked: "The papers can't save yet — check the highlighted rows.",
      saveRowFirst: "Save first",
      allSubjectsAdded: "Every mapped subject has a paper",
      componentSection: "Components",
      componentSubtitle: "The parts of each subject's paper. Weightages must sum to 100.",
      editComponentsFor: "Edit components",
      addComponentRow: "Add component",
      weightSum: "Weightage sum",
      fields: {
        class: "Class",
        subject: "Subject",
        section: "Section",
        date: "Date",
        startTime: "Start",
        duration: "Minutes",
        venue: "Venue",
        name: "Part",
        maxMarks: "Max",
        passMarks: "Pass",
        weightage: "Weight %",
        mandatory: "Must pass",
        gradingScale: "Grading scale",
        gradingScaleHelp: "Give this part its own grade — computed onto the part's result, beside the marks.",
        gradingScaleDefault: "School default",
        negative: "Deduct per wrong answer",
        negativeRate: "Deducted per wrong",
        negativeRateHelp: "Entered marks are net — this records the rate the desk applied.",
        negativeSwitch: "Allows negative marking",
        negativeSwitchHelp:
          "On: parts may deduct per wrong answer and the grid accepts negative entries.",
        passMarksOverride: "Subject pass mark (weighted; blank = sum of parts)",
        passMarksOverrideShort: "pass",
      },
      transitions: {
        scheduled: "Schedule exam",
        ongoing: "Mark ongoing",
        marks_entry: "Open marks entry",
        under_verification: "Start verification",
        back_to_entry: "Back to marks entry",
        back_to_draft: "Back to draft",
        lock: "Lock exam",
        draft: "Back to draft",
        locked: "Lock exam",
        confirmTitle: "Move this exam forward?",
      },
      transitionConsequences: {
        scheduled: "The blueprint is checked for coverage. Once marks entry opens, the schedule freezes.",
        ongoing: "The exam is marked as in progress.",
        marks_entry: "Subject teachers can begin entering marks. The schedule freezes.",
        under_verification: "Entry closes for editing; verification of the entered marks begins.",
        back_to_entry: "Verification found corrections — entry reopens for fixes.",
        back_to_draft: "The exam returns to draft; its schedule can be restructured.",
        lock: "The exam locks permanently. This cannot be undone.",
        draft: "The exam returns to draft; its schedule can be restructured.",
        locked: "The exam locks permanently. This cannot be undone.",
      },
      eligibilityRecomputed: "Eligibility recomputed.",
      studentAllowed: "Student allowed.",
      classPublished: "Class results published.",
      examPublished: (count: number) =>
        count === 1 ? "1 class published." : `${count} classes published.`,
      windowOpened: "Correction window opened.",
      windowClosed: (reIssued: number) =>
        reIssued === 1
          ? "Window closed — 1 card re-issued."
          : `Window closed — ${reIssued} cards re-issued.`,
      publication: {
        title: "Results & publication",
        subtitle:
          "Compute the results, review them, then publish. Parents see results only once published.",
        entries: "Marks entered",
        verified: "Verified",
        stale: "Marks changed since the last compute — compute on the results page before publishing.",
        fresh: "Results up to date",
        eligibilityRecheck: "Recheck attendance eligibility",
        belowBar: "Below the attendance bar (advisory — allowing records the decision)",
        belowCount: (count: number) =>
          count === 1
            ? "1 student below the attendance bar"
            : `${count} students below the attendance bar`,
        allowAll: "Allow all to sit",
        allow: "Allow to sit",
        allowedBadge: "Allowed — recorded",
        allowTitle: "Allow this student?",
        allowAllTitle: "Allow every below-attendance student?",
        allowAllConsequence:
          "One reason is recorded for all of them, with your name. Entry itself is never blocked.",
        reason: "Reason",
        reasonPlaceholder: "e.g. Medical leave certified by the principal",
        reasonRequired: "Say why — the reason is recorded with your name.",
        publishClass: "Publish results for this class",
        publishAll: "Publish all classes",
        publishedNote: "Results become visible to parents when published.",
        viewResults: "View results",
      },
    },
    criteria: {
      title: "Pass Criteria",
      subtitle: "What passing a year means: how many subjects, which are must-pass, grace marks, compartments, and the attendance bar (advisory only).",
      add: "Add pass criteria",
      created: "Pass criteria created.",
      updated: "Pass criteria updated.",
      emptyTitle: "No pass criteria for this year",
      emptyBody: "Add the school-wide default — classes can override it later.",
      defaultBadge: "School default",
      defaultExists: "default exists",
      defaultExistsNote:
        "The school default is set — new rows land as class overrides. Edit a row to change it.",
      classBadge: "Class override",
      fields: {
        class: "Applies to",
        classHelp: "The school default, or one class's override of it.",
        policy: "Absence & exemption",
        minSubjects: "Min subjects to pass (blank = all)",
        mandatory: "Must-pass subjects",
        mandatoryHelp: "Grace marks rescue these subjects first. Empty = none named.",
        grace: "Allow grace marks",
        maxGracePerSubject: "Max grace per subject",
        maxGraceTotal: "Max grace total",
        compartment: "Allow compartment",
        maxCompartmentSubjects: "Max failed subjects for compartment",
        attendance: "Min attendance % (advisory)",
        absentFails: "Skipped mandatory paper fails the subject",
        absentFailsHelp:
          "Off for low-stakes tests: absence then only scores zero, never an automatic fail.",
        absentFailsShort: "Absent mandatory fails",
        absentPassesShort: "Absence never auto-fails",
        exemptRenormalize: "Exempt papers leave the total",
        exemptRenormalizeHelp:
          "On: an exempt paper is excluded, the total is over what the student sat. Off: it scores zero.",
        exemptRenormalizeShort: "Exempt excluded",
        exemptZeroShort: "Exempt scores zero",
      },
    },
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
