import { z } from "zod";

/* ─── Roles ─────────────────────────────────────────────────────────── */

/** Platform-wide role. `admin` is LogixAI staff (content, support). */
export const PLATFORM_ROLES = ["user", "admin"] as const;
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

/** Role inside one institution. */
export const INSTITUTION_ROLES = ["owner", "admin", "instructor", "student"] as const;
export const InstitutionRoleSchema = z.enum(INSTITUTION_ROLES);
export type InstitutionRole = z.infer<typeof InstitutionRoleSchema>;

/** Roles that can be granted through an invite (ownership is never invited). */
export const INVITABLE_ROLES = ["admin", "instructor", "student"] as const;
export const InvitableRoleSchema = z.enum(INVITABLE_ROLES);

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

/* ─── Public shapes ─────────────────────────────────────────────────── */

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  createdAt: string;
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
}

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
});
export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;

export const CreateInviteSchema = z.object({
  role: InvitableRoleSchema.default("student"),
  batchId: z.string().min(1).optional(),
  /** null = unlimited */
  maxUses: z.number().int().min(1).max(5000).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const UpdateMemberSchema = z
  .object({
    role: InstitutionRoleSchema.optional(),
    batchIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((v) => v.role !== undefined || v.batchIds !== undefined, {
    message: "Provide a role or batches to update",
  });
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

export interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
  type: (typeof INSTITUTION_TYPES)[number];
  createdAt: string;
}

export interface MembershipSummary {
  institution: InstitutionSummary;
  role: InstitutionRole;
  batchIds: string[];
  joinedAt: string;
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: InstitutionRole;
  batchIds: string[];
  joinedAt: string;
}

export interface BatchView {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface InviteView {
  id: string;
  code: string;
  role: (typeof INVITABLE_ROLES)[number];
  batchId: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

/** What GET /invites/:code shows before someone joins. */
export interface InvitePreview {
  code: string;
  institution: Pick<InstitutionSummary, "name" | "type">;
  role: (typeof INVITABLE_ROLES)[number];
  batchName: string | null;
  valid: boolean;
  reason?: "expired" | "revoked" | "used_up";
}
