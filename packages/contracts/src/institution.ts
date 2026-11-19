import { z } from "zod";
import { INSTITUTION_TYPES, InstitutionTypeSchema, RollNumberSchema, type BatchView, type InstitutionRole } from "./auth";

/**
 * Institutions as a product: status, per-institution feature switches,
 * contract terms, departments, and who may do what (capabilities + scope).
 * Every new customer is configuration of these, not code.
 */

/* ── Status ── */

export const INSTITUTION_STATUSES = ["active", "suspended", "archived"] as const;
export type InstitutionStatus = (typeof INSTITUTION_STATUSES)[number];

/* ── Feature switches ── */

export const INSTITUTION_FEATURES = [
  /** Tests and exams. */
  "exams",
  /** ML Arena practice, track assignments and practice reports. */
  "arena",
  /** Fullscreen, tab-switch and copy/paste signals during exams. */
  "proctoring",
  /** Written answers graded by hand (phase I3). */
  "subjective",
  /** Detailed test analytics and student overviews (phase I4). */
  "analytics",
  /** Students sign in with institution code + roll number (phase I2). */
  "rollNumberLogin",
  /** Automatic joining by verified email domain (phase I2). */
  "domainJoin",
  /** Institution logo and colours (phase I5). */
  "branding",
  /** Course/program outcome (NAAC/NBA) reports (phase I5). */
  "accreditation",
  /** Placement readiness index (phase I5). */
  "placement",
  /** Parent accounts and reports, for schools (phase I5). */
  "parents",
] as const;
export type InstitutionFeature = (typeof INSTITUTION_FEATURES)[number];
export type FeatureFlags = Record<InstitutionFeature, boolean>;

export const FEATURE_LABELS: Record<InstitutionFeature, { label: string; description: string }> = {
  exams: { label: "Exams", description: "Create, schedule and auto-grade tests." },
  arena: { label: "ML Arena", description: "Assign practice tracks and see practice reports." },
  proctoring: { label: "Proctoring signals", description: "Fullscreen, tab-switch and copy/paste signals in exams." },
  subjective: { label: "Written answers", description: "Short and long answers graded with a rubric." },
  analytics: { label: "Analytics", description: "Detailed test reports and student overviews." },
  rollNumberLogin: { label: "Roll-number login", description: "Students without email sign in with a roll number." },
  domainJoin: { label: "Email domain joining", description: "People with the institution's email domain can join." },
  branding: { label: "Branding", description: "The institution's logo and colours." },
  accreditation: { label: "Accreditation reports", description: "Course and program outcome attainment (NAAC/NBA)." },
  placement: { label: "Placement readiness", description: "A readiness index for the placement office." },
  parents: { label: "Parents", description: "Parent accounts and progress reports." },
};

const allOff = Object.fromEntries(INSTITUTION_FEATURES.map((f) => [f, false])) as FeatureFlags;

/** Sensible defaults per institution type; the platform admin can change any of them. */
export const DEFAULT_FEATURES: Record<(typeof INSTITUTION_TYPES)[number], FeatureFlags> = {
  school: { ...allOff, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, parents: true, rollNumberLogin: true },
  college: { ...allOff, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, placement: true, accreditation: true },
  university: { ...allOff, exams: true, proctoring: true, analytics: true, arena: true, subjective: true, placement: true, accreditation: true, domainJoin: true },
  coaching: { ...allOff, exams: true, proctoring: true, analytics: true, arena: true },
  other: { ...allOff, exams: true, proctoring: true, analytics: true, arena: true },
};

/** Departments suggested when creating an institution of each type (editable). */
export const SUGGESTED_DEPARTMENTS: Record<(typeof INSTITUTION_TYPES)[number], string[]> = {
  school: ["Primary", "Middle school", "Secondary", "Senior secondary"],
  college: ["Computer Science", "Information Technology", "Electronics", "Mechanical"],
  university: ["Computer Science", "Electronics", "Mathematics", "Management"],
  coaching: ["Foundation", "Advanced"],
  other: [],
};

/** Features that existed before switches: off only when an admin turns them off. */
export const featuresWithDefaults = (stored: Partial<FeatureFlags> | null | undefined, type: (typeof INSTITUTION_TYPES)[number]): FeatureFlags => ({
  ...DEFAULT_FEATURES[type],
  ...(stored ?? {}),
});

export const UpdateFeaturesSchema = z
  .object(Object.fromEntries(INSTITUTION_FEATURES.map((f) => [f, z.boolean().optional()])) as Record<InstitutionFeature, z.ZodOptional<z.ZodBoolean>>)
  .strict();
export type UpdateFeaturesInput = z.infer<typeof UpdateFeaturesSchema>;

/* ── Contract ── */

export const PRICING_MODELS = ["per_seat", "flat"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

/**
 * What the institution bought. per_seat: pricePaise per student per year,
 * seats = students bought. flat: pricePaise for the whole term, seats = the
 * band's student limit (null = unlimited). While active, every member has Pro
 * until endsAt, and new students can't join beyond `seats`.
 */
export const ContractSchema = z
  .object({
    model: z.enum(PRICING_MODELS),
    seats: z.number().int().min(1).max(1_000_000).nullable(),
    pricePaise: z.number().int().min(0).max(10_000_000_000),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    notes: z.string().trim().max(2000).default(""),
  })
  .refine((c) => new Date(c.endsAt) > new Date(c.startsAt), { message: "The end date must be after the start date", path: ["endsAt"] })
  .refine((c) => c.model === "flat" || c.seats !== null, { message: "Per-seat contracts need a number of seats", path: ["seats"] });
export type ContractInput = z.infer<typeof ContractSchema>;
export type ContractView = ContractInput & { updatedAt: string };

/* ── Capabilities and scope ── */

export const CAPABILITIES = [
  /** Name, settings, admins. */
  "institution.manage",
  /** Departments and batches. */
  "structure.manage",
  /** Members, roles, invites. */
  "people.manage",
  /** Create, edit and publish tests. */
  "tests.manage",
  /** Grade and review attempts. */
  "tests.grade",
  /** Assign practice tracks. */
  "practice.assign",
  /** Results and reports. */
  "reports.view",
  /** The audit log. */
  "audit.view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<InstitutionRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES,
  dept_head: ["structure.manage", "people.manage", "tests.manage", "tests.grade", "practice.assign", "reports.view"],
  instructor: ["tests.manage", "tests.grade", "practice.assign", "reports.view"],
  assistant: ["tests.grade", "reports.view"],
  student: [],
};

export const capabilitiesFor = (role: InstitutionRole): Capability[] => [...ROLE_CAPABILITIES[role]];
export const can = (role: InstitutionRole, capability: Capability) => ROLE_CAPABILITIES[role].includes(capability);

/** Owners and admins act on the whole institution; everyone else only within their batches. */
export const hasInstitutionWideScope = (role: InstitutionRole) => role === "owner" || role === "admin";

/** Higher number = more senior (for sorting and "can't act on someone senior to you"). */
export const ROLE_SENIORITY: Record<InstitutionRole, number> = {
  owner: 6,
  admin: 5,
  dept_head: 4,
  instructor: 3,
  assistant: 2,
  student: 1,
};

export const ROLE_LABELS: Record<InstitutionRole, string> = {
  owner: "Owner",
  admin: "Admin",
  dept_head: "Department head",
  instructor: "Instructor",
  assistant: "Assistant",
  student: "Student",
};

/**
 * What a member may act on: everything (owners, admins), or a set of batches —
 * a department head's departments' batches, an instructor's or assistant's own
 * batches, a student's own batches (as a learner).
 */
export interface AccessScope {
  all: boolean;
  batchIds: string[];
  departmentIds: string[];
}

/** The caller's place in an institution (GET /institutions/:id). */
export interface InstitutionAccess {
  role: InstitutionRole;
  capabilities: Capability[];
  scope: AccessScope;
  /** True when a LogixAI platform admin is viewing for support. */
  support: boolean;
}

/* ── Departments and batches ── */

export const CreateDepartmentSchema = z.object({
  name: z.string().trim().min(1, "Enter a department name").max(80),
  code: z.string().trim().max(20).default(""),
});
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentSchema>;
export const UpdateDepartmentSchema = CreateDepartmentSchema.partial();

export interface DepartmentView {
  id: string;
  name: string;
  code: string;
  batchCount: number;
  createdAt: string;
}

/** "2026-27" or "2026". */
export const AcademicYearSchema = z.string().trim().regex(/^\d{4}(-\d{2})?$/, "Use a year like 2026 or 2026-27");

export const UpdateBatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  departmentId: z.string().min(1).nullable().optional(),
  academicYear: AcademicYearSchema.nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateBatchInput = z.infer<typeof UpdateBatchSchema>;

/* ── Platform admin ── */

/** Webmail domains can't be an institution's domain: anyone can have an address there. */
export const PUBLIC_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "rediffmail.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "zoho.com",
] as const;

export const EmailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^@/, ""))
  .pipe(
    z
      .string()
      .regex(/^(?=.{3,100}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, "Enter a domain like abc.edu.in")
      .refine((d) => !(PUBLIC_EMAIL_DOMAINS as readonly string[]).includes(d), "Public email providers can't be used"),
  );


const ownerEmail = z.string().trim().toLowerCase().email("Enter a valid email address");

export const AdminCreateInstitutionSchema = z.object({
  name: z.string().trim().min(2, "Enter the institution's name").max(120),
  type: InstitutionTypeSchema,
  /** Owners (heads). Existing accounts become owners at once; others get an owner invite code. */
  ownerEmails: z.array(ownerEmail).min(1, "Add at least one owner").max(5),
  departments: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  features: UpdateFeaturesSchema.optional(),
  contract: ContractSchema.optional(),
});
export type AdminCreateInstitutionInput = z.infer<typeof AdminCreateInstitutionSchema>;

export const AdminUpdateInstitutionSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    type: InstitutionTypeSchema.optional(),
    status: z.enum(INSTITUTION_STATUSES).optional(),
    /** Email domains whose people may ask to join (with the domainJoin feature). */
    emailDomains: z.array(EmailDomainSchema).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type AdminUpdateInstitutionInput = z.infer<typeof AdminUpdateInstitutionSchema>;

export const AddOwnerSchema = z.object({ email: ownerEmail });

export interface OwnerInviteView {
  email: string;
  code: string;
  expiresAt: string;
}

export interface AdminInstitutionSummary {
  id: string;
  name: string;
  slug: string;
  type: (typeof INSTITUTION_TYPES)[number];
  status: InstitutionStatus;
  ownerNames: string[];
  students: number;
  staff: number;
  seats: number | null;
  contractEndsAt: string | null;
  /** Members seen in the last 7 days. */
  activeLast7Days: number;
  createdAt: string;
}

export interface AdminInstitutionDetail extends AdminInstitutionSummary {
  features: FeatureFlags;
  emailDomains: string[];
  contract: ContractView | null;
  departments: number;
  batches: number;
  roleCounts: Record<InstitutionRole, number>;
  pendingOwnerInvites: OwnerInviteView[];
}

export interface AdminCreateInstitutionResult {
  institution: AdminInstitutionDetail;
  /** Owners who already had an account and were added straight away. */
  ownersAdded: string[];
  /** Owners without an account yet: share these codes with them. */
  ownerInvites: OwnerInviteView[];
}


/* ── Onboarding (phase I2) ── */

/** One CSV row as the browser read it; identity-service validates each row on its own. */
export const ImportRowSchema = z.object({
  name: z.string().max(200).default(""),
  rollNumber: z.string().max(100).default(""),
  email: z.string().max(200).default(""),
  /** Batch name; empty = the import's default batch. */
  batch: z.string().max(100).default(""),
});
export type ImportRowInput = z.infer<typeof ImportRowSchema>;

export const IMPORT_MAX_ROWS = 500;

export const ImportStudentsSchema = z.object({
  rows: z.array(ImportRowSchema).min(1, "The file has no rows").max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time`),
  /** Batch for rows without one. */
  batchId: z.string().min(1).nullable().default(null),
  /** Create batches named in the file that don't exist yet (owners and admins). */
  createBatches: z.boolean().default(false),
  /** Check the file without changing anything. */
  dryRun: z.boolean().default(false),
});
export type ImportStudentsInput = z.infer<typeof ImportStudentsSchema>;

export const IMPORT_ROW_STATUSES = ["created", "added", "updated", "unchanged", "error"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export interface ImportRowResult {
  /** 1-based row number in the file (after the header). */
  row: number;
  name: string;
  rollNumber: string | null;
  email: string | null;
  batchName: string | null;
  /**
   * created: new account (temporary password below); added: existing account
   * joined; updated: existing member got a batch or roll number; unchanged;
   * error: see message.
   */
  status: ImportRowStatus;
  message?: string;
  /** Only for created accounts, only once, never on a dry run. */
  tempPassword?: string;
}

export interface ImportResult {
  dryRun: boolean;
  counts: Record<ImportRowStatus, number>;
  rows: ImportRowResult[];
  /** Batches the import created (or would create on a dry run). */
  batchesCreated: string[];
}

export interface PasswordResetResult {
  tempPassword: string;
}

/* ── Join requests (approvals) ── */

export const JOIN_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];
export type JoinRequestSource = "invite" | "domain";

export interface JoinRequestView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: InstitutionRole;
  batchId: string | null;
  rollNumber: string | null;
  source: JoinRequestSource;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

export const DecideJoinRequestSchema = z.object({
  approve: z.boolean(),
  /** Approving a request without a batch (domain joins): the batch to put them in. */
  batchId: z.string().min(1).nullable().optional(),
});
export type DecideJoinRequestInput = z.infer<typeof DecideJoinRequestSchema>;

/** Body of POST /invites/:code/accept and POST /institutions/:id/join-requests. */
export const JoinSchema = z.object({ rollNumber: RollNumberSchema.optional() });
export type JoinInput = z.infer<typeof JoinSchema>;

/** POST /invites/:code/accept when the invite needs approval (HTTP 202). */
export interface JoinPending {
  pending: true;
  institution: { id: string; name: string; type: (typeof INSTITUTION_TYPES)[number] };
}

/** Institutions the caller can ask to join because of their email domain. */
export interface SuggestedInstitution {
  id: string;
  name: string;
  type: (typeof INSTITUTION_TYPES)[number];
  domain: string;
  /** The caller already asked and is waiting. */
  pending: boolean;
}

/* ── Year rollover ── */

export const PromoteBatchSchema = z
  .object({
    /** An existing batch to move students into… */
    toBatchId: z.string().min(1).optional(),
    /** …or a new one. */
    newBatch: z
      .object({
        name: z.string().trim().min(1, "Enter a batch name").max(60),
        academicYear: AcademicYearSchema.nullable().default(null),
        departmentId: z.string().min(1).nullable().optional(),
      })
      .optional(),
    /** Only these students (default: every student in the batch). */
    userIds: z.array(z.string().min(1)).max(5000).optional(),
    /** Archive the old batch afterwards (its students then don't use seats). */
    archiveSource: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.toBatchId) !== Boolean(v.newBatch), { message: "Choose a batch to move into, or name a new one", path: ["toBatchId"] });
export type PromoteBatchInput = z.infer<typeof PromoteBatchSchema>;

export interface PromoteResult {
  moved: number;
  to: BatchView;
  sourceArchived: boolean;
}
