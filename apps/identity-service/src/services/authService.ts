import {
  FREE_PLAN,
  featuresWithDefaults,
  type AuthSession,
  type ChangePasswordInput,
  type MembershipSummary,
  type RollSignInInput,
  type PlanState,
  type PublicUser,
  type SignInInput,
  type SignUpInput,
} from "@logixai/contracts";
import { ConflictError, ForbiddenError, UnauthorizedError } from "@logixai/service-kit";
import { getDummyHash, hashPassword, verifyPassword } from "../lib/passwords.js";
import { hashToken, newRefreshToken, type TokenIssuer } from "../lib/tokens.js";
import type { Store, UserRecord } from "../store/types.js";
import { toInstitutionSummary } from "./institutionService.js";
import { planFor } from "./planService.js";

/** A refresh token reused within this window is treated as a concurrent refresh (two tabs), not theft. */
const REUSE_GRACE_MS = 30_000;

export function toPublicUser(user: UserRecord, plan: PlanState = FREE_PLAN): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? "",
    mustChangePassword: Boolean(user.mustChangePassword),
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    plan,
  };
}

export interface IssuedSession {
  session: AuthSession;
  /** Opaque refresh token for the httpOnly cookie. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly tokens: TokenIssuer,
    private readonly options: { refreshTokenTtlDays: number; adminEmails: string[] },
  ) {}

  async signUp(input: SignUpInput): Promise<IssuedSession> {
    if (await this.store.users.findByEmail(input.email)) {
      throw new ConflictError("An account with this email already exists. Sign in instead.");
    }
    const isAdmin = this.options.adminEmails
      .map((e) => e.toLowerCase())
      .includes(input.email);
    let user: UserRecord;
    try {
      user = await this.store.users.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: isAdmin ? "admin" : "user",
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError("An account with this email already exists. Sign in instead.");
      }
      throw err;
    }
    return this.startSession(user);
  }

  async signIn(input: SignInInput): Promise<IssuedSession> {
    const user = await this.store.users.findByEmail(input.email);
    // Hash even when the user doesn't exist so timing doesn't reveal accounts.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok) {
      throw new UnauthorizedError("Email or password is incorrect.");
    }
    return this.startSession(user);
  }

  /**
   * Students without email: institution code (its slug) + roll number +
   * password. Works for any member with a roll number while the institution
   * has roll-number login switched on.
   */
  async signInWithRollNumber(input: RollSignInInput): Promise<IssuedSession> {
    const wrong = () => new UnauthorizedError("Institution code, roll number or password is incorrect.");
    const institution = await this.store.institutions.findBySlug(input.institution);
    const membership = institution ? await this.store.memberships.findByRollNumber(institution.id, input.rollNumber) : null;
    const user = membership ? await this.store.users.findById(membership.userId) : null;
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!institution || !user || !ok) throw wrong();
    if (!featuresWithDefaults(institution.features, institution.type).rollNumberLogin) {
      throw new ForbiddenError("Roll-number sign-in isn't switched on for this institution. Sign in with your email.");
    }
    if ((institution.status ?? "active") !== "active") {
      throw new ForbiddenError("This institution is closed right now. Contact your institution.");
    }
    return this.startSession(user);
  }

  /** Sets a new password, signs out every other session and starts a fresh one. */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<IssuedSession> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new UnauthorizedError();
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Your current password is incorrect.");
    }
    const updated = await this.store.users.update(userId, {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
    });
    await this.store.refreshTokens.revokeAllForUser(userId);
    return this.startSession(updated ?? user);
  }

  /** Exchanges a refresh token for a new session, rotating the token. */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedError();
    const record = await this.store.refreshTokens.findByHash(hashToken(refreshToken));
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError();
    }
    if (record.revokedAt) {
      if (Date.now() - record.revokedAt.getTime() > REUSE_GRACE_MS) {
        // An old token came back: assume it was stolen and end every session.
        await this.store.refreshTokens.revokeAllForUser(record.userId);
      }
      throw new UnauthorizedError();
    }
    // Only one concurrent refresh wins the rotation.
    if (!(await this.store.refreshTokens.revoke(record.id))) {
      throw new UnauthorizedError();
    }
    const user = await this.store.users.findById(record.userId);
    if (!user) throw new UnauthorizedError();
    return this.startSession(user);
  }

  async signOut(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const record = await this.store.refreshTokens.findByHash(hashToken(refreshToken));
    if (record) await this.store.refreshTokens.revoke(record.id);
  }

  async me(userId: string): Promise<{ user: PublicUser; memberships: MembershipSummary[] }> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new UnauthorizedError();
    const memberships = await this.store.memberships.listForUser(userId);
    const institutions = await this.store.institutions.findByIds(
      memberships.map((m) => m.institutionId),
    );
    const byId = new Map(institutions.map((i) => [i.id, i]));
    return {
      user: toPublicUser(user, await planFor(this.store, user)),
      memberships: memberships.flatMap((m) => {
        const inst = byId.get(m.institutionId);
        return inst
          ? [
              {
                institution: toInstitutionSummary(inst),
                role: m.role,
                batchIds: m.batchIds,
                departmentIds: m.departmentIds ?? [],
                joinedAt: m.createdAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  }

  private async startSession(user: UserRecord): Promise<IssuedSession> {
    const { token, hash } = newRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + this.options.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.store.refreshTokens.create({
      userId: user.id,
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
    });
    // "Active this week" for institution health; never blocks signing in.
    await this.store.users.touchLastSeen(user.id, new Date()).catch(() => {});
    const plan = await planFor(this.store, user);
    const accessToken = await this.tokens.issueAccessToken({
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email ?? "",
      plan: plan.tier,
      planUntil: plan.until ? Math.floor(new Date(plan.until).getTime() / 1000) : null,
    });
    return {
      session: {
        user: toPublicUser(user, plan),
        accessToken,
        expiresIn: this.tokens.accessTokenTtlSeconds,
      },
      refreshToken: token,
      refreshExpiresAt,
    };
  }
}
