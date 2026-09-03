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

  /** The fees area: five tabs, one vocabulary. Money is never "amount" alone — say which money. */
  fees: {
    subtitle:
      "Fee setup, dues, the collection counter, payments, and the ledger for the session you are working in.",

    /** Tab labels — nouns, not verbs, per the attendance tabs rule. */
    tabs: {
      setup: "Setup",
      dues: "Dues",
      counter: "Counter",
      payments: "Payments",
      ledger: "Ledger",
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
      title: "Dues",
      subtitle:
        "What is still owed this session, student by student. Cashiers collect from the Counter; this is the arrears view.",
      emptyTitle: "No open dues",
      emptyBody:
        "Nothing is outstanding for this session and these filters. Either everything is collected, or no instalments have been generated yet.",
      filterStudent: "Student",
      filterAllStudents: "All students",
      dueBy: "Due by",
      dueByHelp: "Show only instalments due on or before this date.",
      grandTotal: "Total outstanding",
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
      title: "Counter",
      subtitle:
        "Record a payment taken at the desk. What you type here becomes the school's receipt.",
      searchLabel: "Find the student",
      searchPlaceholder: "Name or admission number…",
      selected: "Collecting for",
      noOpenTitle: "Nothing to collect",
      noOpenBody:
        "This student has no instalments with a balance for this session. If you expected dues, check the session switcher.",
      openBalances: "Opening balances",
      openBalancesNote:
        "Last session's carry-forward. Shown for the record — the counter collects instalments only.",
      allocationsTitle: "Allocate the payment",
      allocationsHelp:
        "Tick the instalments this payment is for and type the amount against each. A payment can cover several instalments, or part of one.",
      amount: "Amount",
      payFull: "Pay in full",
      clear: "Clear",
      total: "Payment total",
      lateFeeNote:
        "If a late fee applies, the school's server works it out and it appears on the receipt — it is never typed here.",
      mode: "Paid by",
      modeHelp: "Cash is confirmed immediately. Everything else waits for the bank — it shows as pending until confirmed.",
      paymentDate: "Paid on",
      transactionRef: "Reference",
      transactionRefHelp: "UPI reference, cheque number, or UTR.",
      bankName: "Bank",
      chequeDate: "Cheque date",
      chequeDateHelp: "The date on the cheque, if it is post-dated.",
      remarks: "Remarks",
      remarksHelp: "Optional note for the receipt.",
      submit: "Record payment",
      submitting: "Recording…",
      recorded: (receipt: string) => `Payment recorded — receipt ${receipt}.`,
      pendingNote:
        "Recorded and awaiting confirmation — it shows as pending until a confirmer clears it.",
      receiptTitle: "Receipt",
      print: "Print receipt",
    },

    // ---- Payments ----
    payments: {
      title: "Payments",
      subtitle: "Every payment recorded this session, its status, and the actions it still allows.",
      emptyTitle: "No payments yet",
      emptyBody: "The counter is where payments are recorded — the first one will appear here.",
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
