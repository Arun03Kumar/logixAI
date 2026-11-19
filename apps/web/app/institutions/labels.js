// Mirrors @logixai/contracts (institution.ts); the web app doesn't import contracts.

export const ROLES = ["owner", "admin", "dept_head", "instructor", "assistant", "student"];

export const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  dept_head: "Department head",
  instructor: "Instructor",
  assistant: "Assistant",
  student: "Student",
};

export const ROLE_TONE = {
  owner: "brand",
  admin: "info",
  dept_head: "info",
  instructor: "neutral",
  assistant: "neutral",
  student: "outline",
};

export const ROLE_SENIORITY = { owner: 6, admin: 5, dept_head: 4, instructor: 3, assistant: 2, student: 1 };

export const TYPE_LABEL = {
  school: "School",
  college: "College",
  university: "University",
  coaching: "Coaching institute",
  other: "Other",
};

export const STATUS_LABEL = { active: "Active", suspended: "Suspended", archived: "Archived" };
export const STATUS_TONE = { active: "success", suspended: "warning", archived: "neutral" };

/** Features that do something today; the rest arrive in later phases. */
export const FEATURES = [
  { key: "exams", label: "Exams", description: "Create, schedule and auto-grade tests." },
  { key: "arena", label: "ML Arena", description: "Assign practice tracks and see practice reports." },
  { key: "proctoring", label: "Proctoring signals", description: "Fullscreen, tab-switch and copy/paste signals in exams." },
  { key: "subjective", label: "Written answers", description: "Short and long answers graded with a rubric." },
  { key: "analytics", label: "Analytics", description: "Detailed test reports and student overviews.", soon: true },
  { key: "rollNumberLogin", label: "Roll-number login", description: "Students without email sign in with a roll number." },
  { key: "domainJoin", label: "Email domain joining", description: "People with the institution's email domain can ask to join." },
  { key: "branding", label: "Branding", description: "The institution's logo and colours.", soon: true },
  { key: "accreditation", label: "Accreditation reports", description: "Course and program outcome attainment (NAAC/NBA).", soon: true },
  { key: "placement", label: "Placement readiness", description: "A readiness index for the placement office.", soon: true },
  { key: "parents", label: "Parents", description: "Parent accounts and progress reports.", soon: true },
];

const off = Object.fromEntries(FEATURES.map((f) => [f.key, false]));
export const DEFAULT_FEATURES = {
  school: { ...off, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, parents: true, rollNumberLogin: true },
  college: { ...off, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, placement: true, accreditation: true },
  university: { ...off, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, placement: true, accreditation: true, domainJoin: true },
  coaching: { ...off, exams: true, proctoring: true, analytics: true, arena: true },
  other: { ...off, exams: true, proctoring: true, analytics: true, arena: true },
};

export const SUGGESTED_DEPARTMENTS = {
  school: ["Primary", "Middle school", "Secondary", "Senior secondary"],
  college: ["Computer Science", "Information Technology", "Electronics", "Mechanical"],
  university: ["Computer Science", "Electronics", "Mathematics", "Management"],
  coaching: ["Foundation", "Advanced"],
  other: [],
};

/** access = MembershipSummary.access from GET /institutions/:id. */
export const can = (access, capability) => Boolean(access?.capabilities?.includes(capability));
/** Batches the caller acts on (all of them for owners and admins). */
export const inScope = (access, batchId) => Boolean(access?.scope?.all || access?.scope?.batchIds?.includes(batchId));

/** Roles the caller may give out: below their own, any for owners. */
export const grantableRoles = (myRole) =>
  ROLES.filter((r) => myRole === "owner" || ROLE_SENIORITY[r] < ROLE_SENIORITY[myRole]);

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "—");
