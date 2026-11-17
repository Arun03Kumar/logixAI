import type {
  INSTITUTION_TYPES,
  INVITABLE_ROLES,
  InstitutionRole,
  PlatformRole,
} from "@logixai/contracts";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: PlatformRole;
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
  createdAt: Date;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  institutionId: string;
  role: InstitutionRole;
  batchIds: string[];
  createdAt: Date;
}

export interface BatchRecord {
  id: string;
  institutionId: string;
  name: string;
  createdAt: Date;
}

export interface InviteRecord {
  id: string;
  institutionId: string;
  code: string;
  role: (typeof INVITABLE_ROLES)[number];
  batchId: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: string;
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
  };
  memberships: {
    create(data: New<MembershipRecord>): Promise<MembershipRecord>;
    find(userId: string, institutionId: string): Promise<MembershipRecord | null>;
    listForUser(userId: string): Promise<MembershipRecord[]>;
    listForInstitution(institutionId: string): Promise<MembershipRecord[]>;
    update(
      id: string,
      patch: Partial<Pick<MembershipRecord, "role" | "batchIds">>,
    ): Promise<MembershipRecord | null>;
    addBatch(id: string, batchId: string): Promise<void>;
    delete(id: string): Promise<void>;
    countByRole(institutionId: string, role: InstitutionRole): Promise<number>;
  };
  batches: {
    create(data: New<BatchRecord>): Promise<BatchRecord>;
    findById(id: string): Promise<BatchRecord | null>;
    findByName(institutionId: string, name: string): Promise<BatchRecord | null>;
    listForInstitution(institutionId: string): Promise<BatchRecord[]>;
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
}
