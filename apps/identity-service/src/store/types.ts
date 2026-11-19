import {
  ROLE_SENIORITY,
  type AuditEvent,
  type FeatureFlags,
  type INSTITUTION_TYPES,
  type INVITE_ROLES,
  type InstitutionRole,
  type InstitutionStatus,
  type JoinRequestSource,
  type JoinRequestStatus,
  type PlatformRole,
  type PricingModel,
} from "@logixai/contracts";

export interface UserRecord {
  id: string;
  name: string;
  /** null: an account an institution created for someone without email (roll-number sign-in). */
  email: string | null;
  passwordHash: string;
  role: PlatformRole;
  /** The institution that created this account (CSV import); its staff can reset the password. */
  managedBy?: string | null;
  /** Set with a temporary password; cleared when the user picks their own. */
  mustChangePassword?: boolean;
  /** Personal Pro (bought, trial or granted) lasts until this moment. */
  proUntil?: Date | null;
  /** Last sign-in or session refresh (institution health: "active this week"). */
  lastSeenAt?: Date | null;
  createdAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InstitutionRecord {
  id: string;
  name: string;
  slug: string;
  type: (typeof INSTITUTION_TYPES)[number];
  createdBy: string;
  /** Institution licence: every member has Pro until then. Set from the contract. */
  licenceUntil?: Date | null;
  licenceSeats?: number | null;
  /** Missing on institutions created before statuses existed: treat as active. */
  status?: InstitutionStatus;
  /** Only the switches that differ from the type's defaults need to be stored. */
  features?: Partial<FeatureFlags>;
  contract?: ContractRecord | null;
  /** People with these email domains may ask to join (domainJoin feature). */
  emailDomains?: string[];
  createdAt: Date;
}

export interface ContractRecord {
  model: PricingModel;
  seats: number | null;
  pricePaise: number;
  startsAt: Date;
  endsAt: Date;
  notes: string;
  updatedAt: Date;
}

export interface DepartmentRecord {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  createdAt: Date;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  institutionId: string;
  role: InstitutionRole;
  batchIds: string[];
  /** Department heads: the departments they lead. */
  departmentIds?: string[];
  /** Upper-case, unique within the institution. */
  rollNumber?: string | null;
  createdAt: Date;
}

export interface BatchRecord {
  id: string;
  institutionId: string;
  name: string;
  departmentId?: string | null;
  academicYear?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
}

export interface InviteRecord {
  id: string;
  institutionId: string;
  code: string;
  role: (typeof INVITE_ROLES)[number];
  /** Owner invites: who it was created for. */
  email?: string | null;
  batchId: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: string;
  /** Joining with it creates a join request for staff to approve. */
  requiresApproval?: boolean;
  createdAt: Date;
}

export interface JoinRequestRecord {
  id: string;
  institutionId: string;
  userId: string;
  role: InstitutionRole;
  batchId: string | null;
  rollNumber: string | null;
  source: JoinRequestSource;
  inviteId: string | null;
  status: JoinRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

type New<T> = Omit<T, "id" | "createdAt">;

/**
 * Persistence used by the services. MongoStore is the real one; tests use
 * MemoryStore. Keeping this boundary lets the business rules be tested
 * without a database.
 */
export interface Store {
  users: {
    create(data: New<UserRecord>): Promise<UserRecord>;
    findById(id: string): Promise<UserRecord | null>;
    findByEmail(email: string): Promise<UserRecord | null>;
    findByIds(ids: string[]): Promise<UserRecord[]>;
    findByEmails(emails: string[]): Promise<UserRecord[]>;
    update(id: string, patch: Partial<Pick<UserRecord, "name" | "passwordHash" | "mustChangePassword">>): Promise<UserRecord | null>;
    touchLastSeen(userId: string, at: Date): Promise<void>;
    /** Adds days of Pro from max(now, current end), atomically. Returns the new end. */
    extendPro(userId: string, days: number, now: Date): Promise<Date | null>;
  };
  entitlements: {
    /** Records a grant once per reference. False if that reference was already granted. */
    recordGrant(grant: { reference: string; userId: string; days: number; source: string; at: Date }): Promise<boolean>;
  };
  refreshTokens: {
    create(data: New<RefreshTokenRecord>): Promise<RefreshTokenRecord>;
    findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
    /** Marks the token revoked if it isn't already. Returns false if it already was. */
    revoke(id: string): Promise<boolean>;
    revokeAllForUser(userId: string): Promise<void>;
  };
  institutions: {
    create(data: New<InstitutionRecord>): Promise<InstitutionRecord>;
    findById(id: string): Promise<InstitutionRecord | null>;
    findByIds(ids: string[]): Promise<InstitutionRecord[]>;
    slugExists(slug: string): Promise<boolean>;
    findBySlug(slug: string): Promise<InstitutionRecord | null>;
    /** Active institutions that list this email domain. */
    findByEmailDomain(domain: string): Promise<InstitutionRecord[]>;
    setLicence(id: string, until: Date | null, seats: number | null): Promise<InstitutionRecord | null>;
    update(
      id: string,
      patch: Partial<Pick<InstitutionRecord, "name" | "type" | "status" | "features" | "contract" | "licenceUntil" | "licenceSeats" | "emailDomains">>,
    ): Promise<InstitutionRecord | null>;
    /** Platform admin: newest first, optionally matching name or slug. */
    search(query: string | undefined, limit: number): Promise<InstitutionRecord[]>;
  };
  memberships: {
    create(data: New<MembershipRecord>): Promise<MembershipRecord>;
    find(userId: string, institutionId: string): Promise<MembershipRecord | null>;
    findByRollNumber(institutionId: string, rollNumber: string): Promise<MembershipRecord | null>;
    findByRollNumbers(institutionId: string, rollNumbers: string[]): Promise<MembershipRecord[]>;
    findForUsers(institutionId: string, userIds: string[]): Promise<MembershipRecord[]>;
    listForUser(userId: string): Promise<MembershipRecord[]>;
    countForInstitutions(institutionIds: string[]): Promise<Record<string, number>>;
    /** institutionId -> role -> members. */
    roleCounts(institutionIds: string[]): Promise<Record<string, Partial<Record<InstitutionRole, number>>>>;
    /** institutionId -> members whose account was seen since `since`. */
    activeSince(institutionIds: string[], since: Date): Promise<Record<string, number>>;
    /**
     * Members of an institution, highest role first, then by join order.
     * Keyset-paginated: pass back the returned `nextCursor`.
     */
    pageForInstitution(
      institutionId: string,
      query: { limit: number; cursor?: string; role?: InstitutionRole; userIds?: string[]; batchId?: string; batchIds?: string[] },
    ): Promise<{ items: MembershipRecord[]; nextCursor: string | null }>;
    /** Number of members in each batch (one aggregation, not a full scan in the app). */
    countByBatch(institutionId: string): Promise<Record<string, number>>;
    update(
      id: string,
      patch: Partial<Pick<MembershipRecord, "role" | "batchIds" | "departmentIds" | "rollNumber">>,
    ): Promise<MembershipRecord | null>;
    addBatch(id: string, batchId: string): Promise<void>;
    delete(id: string): Promise<void>;
    countByRole(institutionId: string, role: InstitutionRole): Promise<number>;
    /** Students using a seat: in no batch, or in at least one batch that isn't archived. */
    countSeatedStudents(institutionId: string, archivedBatchIds: string[]): Promise<number>;
    /** Moves students from one batch to another (all of them, or only userIds). Returns how many moved. */
    moveBatch(institutionId: string, fromBatchId: string, toBatchId: string, userIds?: string[]): Promise<number>;
  };
  batches: {
    create(data: New<BatchRecord>): Promise<BatchRecord>;
    findById(id: string): Promise<BatchRecord | null>;
    findByName(institutionId: string, name: string): Promise<BatchRecord | null>;
    listForInstitution(institutionId: string): Promise<BatchRecord[]>;
    update(id: string, patch: Partial<Pick<BatchRecord, "name" | "departmentId" | "academicYear" | "archivedAt">>): Promise<BatchRecord | null>;
  };
  departments: {
    /** Throws an error with code 11000 if the name is taken in the institution. */
    create(data: New<DepartmentRecord>): Promise<DepartmentRecord>;
    findById(id: string): Promise<DepartmentRecord | null>;
    listForInstitution(institutionId: string): Promise<DepartmentRecord[]>;
    update(id: string, patch: Partial<Pick<DepartmentRecord, "name" | "code">>): Promise<DepartmentRecord | null>;
    delete(id: string): Promise<void>;
  };
  invites: {
    create(data: New<InviteRecord>): Promise<InviteRecord>;
    findById(id: string): Promise<InviteRecord | null>;
    findByCode(code: string): Promise<InviteRecord | null>;
    listForInstitution(institutionId: string): Promise<InviteRecord[]>;
    /** Atomically takes one use. False when the invite is used up. */
    consumeUse(id: string): Promise<boolean>;
    revoke(id: string): Promise<void>;
  };
  joinRequests: {
    /** Throws code 11000 if the user already has a pending request here. */
    create(data: New<JoinRequestRecord>): Promise<JoinRequestRecord>;
    findById(id: string): Promise<JoinRequestRecord | null>;
    /** Newest first. */
    listForInstitution(institutionId: string, status: JoinRequestStatus, limit: number): Promise<JoinRequestRecord[]>;
    pendingForUser(userId: string): Promise<JoinRequestRecord[]>;
    /** Settles a pending request; null if it was already decided. */
    decide(id: string, status: Exclude<JoinRequestStatus, "pending">, by: string, at: Date): Promise<JoinRequestRecord | null>;
  };
  audit: {
    record(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
    pageForInstitution(
      institutionId: string,
      query: { limit: number; cursor?: string },
    ): Promise<{ items: AuditEvent[]; nextCursor: string | null }>;
  };
}

/** Role order used for listing members (owners first). Stored on memberships as roleRank. */
export const ROLE_RANK: Record<InstitutionRole, number> = ROLE_SENIORITY;
