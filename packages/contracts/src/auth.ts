import type { PlanState, PlanTier } from "./billing";
import type { FeatureFlags, InstitutionAccess, InstitutionStatus } from "./institution";
import { z } from "zod";

/* ─── Roles ─────────────────────────────────────────────────────────── */

/** Platform-wide role. `admin` is LogixAI staff (content, support). */
export const PLATFORM_ROLES = ["user", "admin"] as const;
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

/**
 * Role inside one institution, highest first. Department heads act only inside
 * their departments; instructors and assistants only inside their batches.
 */
export const INSTITUTION_ROLES = ["owner", "admin", "dept_head", "instructor", "assistant", "student"] as const;
export const InstitutionRoleSchema = z.enum(INSTITUTION_ROLES);
export type InstitutionRole = z.infer<typeof InstitutionRoleSchema>;

/** Roles an institution can hand out through an invite. Owner invites come only from LogixAI. */
export const INVITABLE_ROLES = ["admin", "dept_head", "instructor", "assistant", "student"] as const;
export const InvitableRoleSchema = z.enum(INVITABLE_ROLES);
/** Every role an invite record can carry (owner: created by a platform admin). */
export const INVITE_ROLES = ["owner", ...INVITABLE_ROLES] as const;

export const INSTITUTION_TYPES = [
  "school",
  "college",
  "university",
  "coaching",
  "other",
] as const;
export const InstitutionTypeSchema = z.enum(INSTITUTION_TYPES);

/* ─── Auth requests ─────────────────────────────────────────────────── */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }));

export const PASSWORD_MIN_LENGTH = 8;

export const SignUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(128),
});
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const SignInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(128),
});
export type SignInInput = z.infer<typeof SignInSchema>;

/** Roll numbers are case-insensitive: stored upper-case, unique per institution. */
export const ROLL_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9\-/_.]{0,39}$/;
export const RollNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ROLL_NUMBER_PATTERN, "Use up to 40 letters, numbers, - / _ or .");

/** Students without email: institution code (slug) + roll number + password. */
export const RollSignInSchema = z.object({
  institution: z.string().trim().toLowerCase().min(1, "Enter your institution code").max(60),
  rollNumber: RollNumberSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
export type RollSignInInput = z.infer<typeof RollSignInSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: "Choose a different password", path: ["newPassword"] });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/* ─── Public shapes ─────────────────────────────────────────────────── */

export interface PublicUser {
  id: string;
  name: string;
  /** Empty for accounts an institution created without email (roll-number sign-in). */
  email: string;
  /** Signed in with a temporary password: ask for a new one first. */
  mustChangePassword: boolean;
  role: PlatformRole;
  createdAt: string;
  /** Free or Pro right now (personal pass, trial or an institution licence). */
  plan: PlanState;
}

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

/** Claims carried by every access token (JWT). */
export interface AccessTokenClaims {
  /** user id */
  sub: string;
  role: PlatformRole;
  name: string;
  email: string;
  /** "pro" while a pass or licence is active at issue time; check planUntil too. */
  plan: PlanTier;
  /** When Pro ends, as Unix seconds; null on free. */
  planUntil: number | null;
}

/** Pro right now? Tokens live 15 minutes, so a pass can end mid-token. */
export const hasPro = (claims: Pick<AccessTokenClaims, "plan" | "planUntil"> | null | undefined, now = Date.now()) =>
  claims?.plan === "pro" && claims.planUntil !== null && claims.planUntil * 1000 > now;

/** JWT audience every LogixAI service checks. */
export const ACCESS_TOKEN_AUDIENCE = "logixai";
export const DEFAULT_TOKEN_ISSUER = "logixai-identity";

/* ─── Institutions ──────────────────────────────────────────────────── */

export const CreateInstitutionSchema = z.object({
  name: z.string().trim().min(2, "Enter the institution's name").max(120),
  type: InstitutionTypeSchema,
});
export type CreateInstitutionInput = z.infer<typeof CreateInstitutionSchema>;

export const CreateBatchSchema = z.object({
  name: z.string().trim().min(1, "Enter a batch name").max(60),
  departmentId: z.string().min(1).nullable().default(null),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}(-\d{2})?$/, "Use a year like 2026 or 2026-27")
    .nullable()
    .default(null),
});
export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;

export const CreateInviteSchema = z.object({
  role: InvitableRoleSchema.default("student"),
  batchId: z.string().min(1).optional(),
  /** null = unlimited */
  maxUses: z.number().int().min(1).max(5000).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  /** People who use it wait for a staff member to approve them. */
  requiresApproval: z.boolean().default(false),
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const UpdateMemberSchema = z
  .object({
    role: InstitutionRoleSchema.optional(),
    batchIds: z.array(z.string().min(1)).max(50).optional(),
    /** For department heads: which departments they lead. */
    departmentIds: z.array(z.string().min(1)).max(20).optional(),
    /** null removes it. */
    rollNumber: RollNumberSchema.nullable().optional(),
  })
  .refine((v) => v.role !== undefined || v.batchIds !== undefined || v.departmentIds !== undefined || v.rollNumber !== undefined, {
    message: "Provide a role, batches, departments or roll number to update",
  });
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

export interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
  type: (typeof INSTITUTION_TYPES)[number];
  status: InstitutionStatus;
  /** Which product areas are switched on for this institution. */
  features: FeatureFlags;
  createdAt: string;
}

export interface MembershipSummary {
  institution: InstitutionSummary;
  role: InstitutionRole;
  batchIds: string[];
  /** Department heads: the departments they lead. */
  departmentIds: string[];
  joinedAt: string;
  /** What the caller may do here (GET /institutions/:id includes it). */
  access?: InstitutionAccess;
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: InstitutionRole;
  batchIds: string[];
  departmentIds: string[];
  rollNumber: string | null;
  /** The institution created this account (no email, or imported): staff can reset its password. */
  managed: boolean;
  joinedAt: string;
}

export interface BatchView {
  id: string;
  name: string;
  departmentId: string | null;
  academicYear: string | null;
  archived: boolean;
  memberCount: number;
  createdAt: string;
}

export interface InviteView {
  id: string;
  code: string;
  role: (typeof INVITE_ROLES)[number];
  batchId: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: string;
  revoked: boolean;
  requiresApproval: boolean;
  createdAt: string;
}

/** What GET /invites/:code shows before someone joins. */
export interface InvitePreview {
  code: string;
  institution: Pick<InstitutionSummary, "name" | "type">;
  role: (typeof INVITE_ROLES)[number];
  batchName: string | null;
  valid: boolean;
  requiresApproval: boolean;
  /** The institution uses roll numbers: ask for one when joining. */
  asksRollNumber: boolean;
  reason?: "expired" | "revoked" | "used_up";
}
