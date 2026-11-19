import {
  ROLE_SENIORITY,
  ROLL_NUMBER_PATTERN,
  featuresWithDefaults,

  type DecideJoinRequestInput,
  type ImportResult,
  type ImportRowResult,
  type ImportRowStatus,
  type ImportStudentsInput,
  type InstitutionRole,
  type JoinInput,
  type JoinPending,
  type JoinRequestStatus,
  type JoinRequestView,
  type MembershipSummary,
  type PasswordResetResult,
  type PromoteBatchInput,
  type PromoteResult,
  type SuggestedInstitution,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, z } from "@logixai/service-kit";
import { hashPassword } from "../lib/passwords.js";
import { newTempPassword } from "../lib/tokens.js";
import type { BatchRecord, InstitutionRecord, JoinRequestRecord, MembershipRecord, Store, UserRecord } from "../store/types.js";
import { INVITE_MESSAGES, inviteProblem, toBatchView, toMembershipSummary, type InstitutionService } from "./institutionService.js";

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;
const ROLL_TAKEN = "That roll number is already used in this institution.";
const emailOk = (email: string) => z.email().safeParse(email).success;
const domainOf = (email: string | null) => (email && email.includes("@") ? email.split("@").pop()!.toLowerCase() : null);

/** Hash passwords a few at a time: scrypt runs on libuv's small thread pool. */
async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/**
 * Phase I2: getting people in at scale and keeping them organised — CSV
 * import (with roll-number accounts for students without email), approvals
 * for invites and email-domain joining, password resets for accounts the
 * institution created, and moving students to next year's batch.
 */
export class OnboardingService {
  constructor(
    private readonly store: Store,
    private readonly institutions: InstitutionService,
  ) {}

  /* ── Seats ── */

  /** Seats left under the contract (Infinity without a seat limit). Archived batches free their students' seats. */
  private async seatsLeft(inst: InstitutionRecord): Promise<number> {
    const seats = inst.contract?.seats;
    if (!seats) return Infinity;
    const batches = await this.store.batches.listForInstitution(inst.id);
    const archived = batches.filter((b) => b.archivedAt).map((b) => b.id);
    return Math.max(0, seats - (await this.store.memberships.countSeatedStudents(inst.id, archived)));
  }

  private async assertSeat(inst: InstitutionRecord) {
    if ((await this.seatsLeft(inst)) < 1) {
      throw new ConflictError("This institution has used all its student seats. Ask your institution to add seats.");
    }
  }

  private async assertRollFree(institutionId: string, rollNumber: string | null | undefined, userId?: string) {
    if (!rollNumber) return;
    const holder = await this.store.memberships.findByRollNumber(institutionId, rollNumber);
    if (holder && holder.userId !== userId) throw new ConflictError(ROLL_TAKEN);
  }

  /** Creates a membership after the seat and roll-number checks. */
  private async admit(inst: InstitutionRecord, userId: string, role: InstitutionRole, batchId: string | null, rollNumber: string | null) {
    if (role === "student") await this.assertSeat(inst);
    await this.assertRollFree(inst.id, rollNumber);
    try {
      return await this.store.memberships.create({
        userId,
        institutionId: inst.id,
        role,
        batchIds: batchId ? [batchId] : [],
        departmentIds: [],
        rollNumber,
      });
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictError("Already a member, or that roll number is already used here.");
      throw err;
    }
  }

  /* ── Invites ── */

  /**
   * Joins with an invite code. Invites that need approval create a join
   * request instead (the caller gets `{ pending: true }`). Existing members
   * keep their role; the invite only adds its batch (or makes them owner).
   */
  async acceptInvite(userId: string, code: string, input: JoinInput): Promise<MembershipSummary | JoinPending> {
    const invite = await this.store.invites.findByCode(code.toUpperCase());
    if (!invite) throw new NotFoundError("Invite", code);
    const reason = inviteProblem(invite);
    if (reason) throw new BadRequestError("invite", { reason: INVITE_MESSAGES[reason] });

    const institution = await this.store.institutions.findById(invite.institutionId);
    if (!institution) throw new NotFoundError("Invite", code);
    if ((institution.status ?? "active") !== "active") {
      throw new ForbiddenError("This institution isn't accepting new members right now.");
    }
    const rollNumber = invite.role === "student" ? (input.rollNumber ?? null) : null;

    let membership = await this.store.memberships.find(userId, institution.id);
    if (!membership) {
      if (invite.requiresApproval && invite.role !== "owner") {
        await this.assertRollFree(institution.id, rollNumber);
        if (!(await this.store.invites.consumeUse(invite.id))) throw new BadRequestError("invite", { reason: INVITE_MESSAGES.used_up });
        await this.createRequest({ institution, userId, role: invite.role, batchId: invite.batchId, rollNumber, source: "invite", inviteId: invite.id });
        return this.pending(institution);
      }
      if (invite.role === "student") await this.assertSeat(institution);
      await this.assertRollFree(institution.id, rollNumber);
      if (!(await this.store.invites.consumeUse(invite.id))) throw new BadRequestError("invite", { reason: INVITE_MESSAGES.used_up });
      membership = await this.admit(institution, userId, invite.role, invite.batchId, rollNumber);
      await this.institutions.audit(userId, "member.joined", institution.id, "member", userId, { role: invite.role, inviteId: invite.id });
    } else if (invite.role === "owner" && membership.role !== "owner") {
      // An owner invite promotes an existing member.
      if (!(await this.store.invites.consumeUse(invite.id))) throw new BadRequestError("invite", { reason: INVITE_MESSAGES.used_up });
      membership = (await this.store.memberships.update(membership.id, { role: "owner" }))!;
      await this.institutions.audit(userId, "member.role_changed", institution.id, "member", userId, { to: "owner", inviteId: invite.id });
    } else if (invite.batchId && !membership.batchIds.includes(invite.batchId)) {
      await this.store.memberships.addBatch(membership.id, invite.batchId);
      membership = { ...membership, batchIds: [...membership.batchIds, invite.batchId] };
    }
    return toMembershipSummary(institution, membership);
  }

  private pending(inst: InstitutionRecord): JoinPending {
    return { pending: true, institution: { id: inst.id, name: inst.name, type: inst.type } };
  }

  private async createRequest(r: {
    institution: InstitutionRecord;
    userId: string;
    role: InstitutionRole;
    batchId: string | null;
    rollNumber: string | null;
    source: JoinRequestRecord["source"];
    inviteId: string | null;
  }) {
    try {
      const req = await this.store.joinRequests.create({
        institutionId: r.institution.id,
        userId: r.userId,
        role: r.role,
        batchId: r.batchId,
        rollNumber: r.rollNumber,
        source: r.source,
        inviteId: r.inviteId,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
      });
      await this.institutions.audit(r.userId, "join_request.created", r.institution.id, "join_request", req.id, { source: r.source, role: r.role });
      return req;
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictError("You've already asked to join. Your institution will approve you soon.");
      throw err;
    }
  }

  /* ── Email domains ── */

  /** Institutions the caller may ask to join because of their email's domain. */
  async suggested(userId: string): Promise<SuggestedInstitution[]> {
    const user = await this.store.users.findById(userId);
    const domain = domainOf(user?.email ?? null);
    if (!user || !domain) return [];
    const [candidates, mine, pending] = await Promise.all([
      this.store.institutions.findByEmailDomain(domain),
      this.store.memberships.listForUser(userId),
      this.store.joinRequests.pendingForUser(userId),
    ]);
    const member = new Set(mine.map((m) => m.institutionId));
    const waiting = new Set(pending.map((r) => r.institutionId));
    return candidates
      .filter((i) => !member.has(i.id) && featuresWithDefaults(i.features, i.type).domainJoin)
      .map((i) => ({ id: i.id, name: i.name, type: i.type, domain, pending: waiting.has(i.id) }));
  }

  /**
   * Asks to join as a student because of a matching email domain. Email
   * addresses aren't verified yet, so a staff member always approves.
   */
  async requestByDomain(userId: string, institutionId: string, input: JoinInput): Promise<JoinPending> {
    const [user, inst] = await Promise.all([this.store.users.findById(userId), this.store.institutions.findById(institutionId)]);
    const domain = domainOf(user?.email ?? null);
    const allowed =
      inst &&
      (inst.status ?? "active") === "active" &&
      featuresWithDefaults(inst.features, inst.type).domainJoin &&
      domain !== null &&
      (inst.emailDomains ?? []).includes(domain);
    if (!user || !inst || !allowed) throw new NotFoundError("Institution", institutionId);
    if (await this.store.memberships.find(userId, inst.id)) throw new ConflictError("You're already a member.");
    await this.assertRollFree(inst.id, input.rollNumber);
    await this.createRequest({ institution: inst, userId, role: "student", batchId: null, rollNumber: input.rollNumber ?? null, source: "domain", inviteId: null });
    return this.pending(inst);
  }

  /* ── Approvals ── */

  private async requestViews(rows: JoinRequestRecord[]): Promise<JoinRequestView[]> {
    const users = new Map((await this.store.users.findByIds(rows.map((r) => r.userId))).map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: users.get(r.userId)?.name ?? "Deleted account",
      email: users.get(r.userId)?.email ?? "",
      role: r.role,
      batchId: r.batchId,
      rollNumber: r.rollNumber,
      source: r.source,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }

  /** Requests the caller can decide: requests for their batches, and domain requests (no batch yet). */
  async listJoinRequests(actorId: string, institutionId: string, status: JoinRequestStatus): Promise<JoinRequestView[]> {
    const a = await this.institutions.access(actorId, institutionId, "people.manage");
    const rows = await this.store.joinRequests.listForInstitution(institutionId, status, 200);
    return this.requestViews(rows.filter((r) => a.scope.all || r.batchId === null || a.scope.batchIds.includes(r.batchId)));
  }

  async decide(actorId: string, institutionId: string, requestId: string, input: DecideJoinRequestInput): Promise<JoinRequestView> {
    const a = await this.institutions.access(actorId, institutionId, "people.manage");
    const req = await this.store.joinRequests.findById(requestId);
    if (!req || req.institutionId !== institutionId) throw new NotFoundError("Join request", requestId);
    if (req.status !== "pending") throw new ConflictError("Someone already decided this request.");
    if (req.batchId && !a.scope.all && !a.scope.batchIds.includes(req.batchId)) throw new ForbiddenError("That request is for a batch that isn't yours.");
    if (a.membership.role !== "owner" && ROLE_SENIORITY[req.role] >= ROLE_SENIORITY[a.membership.role]) {
      throw new ForbiddenError("You can only approve people for roles below your own.");
    }

    if (input.approve) {
      let batchId = req.batchId;
      if (!batchId && input.batchId) {
        const batch = await this.store.batches.findById(input.batchId);
        if (!batch || batch.institutionId !== institutionId) throw new BadRequestError("batchId", { reason: "Unknown batch" });
        if (batch.archivedAt) throw new BadRequestError("batchId", { reason: "That batch is archived." });
        if (!a.scope.all && !a.scope.batchIds.includes(batch.id)) throw new ForbiddenError("That batch isn't yours.");
        batchId = batch.id;
      }
      if (!batchId && !a.scope.all) throw new BadRequestError("batchId", { reason: "Choose one of your batches for them." });
      const existing = await this.store.memberships.find(req.userId, institutionId);
      if (existing) {
        if (batchId) await this.store.memberships.addBatch(existing.id, batchId);
      } else {
        await this.admit(a.institution, req.userId, req.role, batchId, req.rollNumber);
        await this.institutions.audit(req.userId, "member.joined", institutionId, "member", req.userId, { role: req.role, requestId: req.id });
      }
    }

    const decided = await this.store.joinRequests.decide(req.id, input.approve ? "approved" : "rejected", actorId, new Date());
    if (!decided) throw new ConflictError("Someone already decided this request.");
    await this.institutions.audit(actorId, input.approve ? "join_request.approved" : "join_request.rejected", institutionId, "join_request", req.id, {
      userId: req.userId,
      role: req.role,
    });
    return (await this.requestViews([decided]))[0]!;
  }

  /* ── Passwords ── */

  /**
   * Gives a temporary password to an account the institution created (CSV
   * import). People who made their own account manage their own password.
   */
  async resetPassword(actorId: string, institutionId: string, targetUserId: string): Promise<PasswordResetResult> {
    const a = await this.institutions.access(actorId, institutionId, "people.manage");
    const target = await this.store.memberships.find(targetUserId, institutionId);
    if (!target) throw new NotFoundError("Member", targetUserId);
    if (targetUserId === actorId) throw new BadRequestError("member", { reason: "Change your own password from your account instead." });
    this.institutions.assertSenior(a.membership, target);
    if (!a.scope.all && !target.batchIds.some((b) => a.scope.batchIds.includes(b))) throw new ForbiddenError("That member isn't in your batches.");
    const user = await this.store.users.findById(targetUserId);
    if (!user) throw new NotFoundError("Member", targetUserId);
    if (user.managedBy !== institutionId) {
      throw new ForbiddenError("This person created their own account, so only they can change its password.");
    }
    const tempPassword = newTempPassword();
    await this.store.users.update(user.id, { passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
    await this.store.refreshTokens.revokeAllForUser(user.id);
    await this.institutions.audit(actorId, "member.password_reset", institutionId, "member", user.id, {});
    return { tempPassword };
  }

  /* ── Year rollover ── */

  /** Moves a batch's students (or some of them) into another batch, optionally archiving the old one. */
  async promote(actorId: string, institutionId: string, batchId: string, input: PromoteBatchInput): Promise<PromoteResult> {
    const a = await this.institutions.access(actorId, institutionId, "structure.manage");
    const source = await this.store.batches.findById(batchId);
    if (!source || source.institutionId !== institutionId) throw new NotFoundError("Batch", batchId);
    const mine = (b: BatchRecord) => a.scope.all || a.scope.batchIds.includes(b.id) || Boolean(b.departmentId && a.scope.departmentIds.includes(b.departmentId));
    if (!mine(source)) throw new ForbiddenError("That batch isn't yours.");

    let target: BatchRecord;
    if (input.toBatchId) {
      const found = await this.store.batches.findById(input.toBatchId);
      if (!found || found.institutionId !== institutionId) throw new BadRequestError("toBatchId", { reason: "Unknown batch" });
      if (found.id === source.id) throw new BadRequestError("toBatchId", { reason: "Choose a different batch." });
      if (found.archivedAt) throw new BadRequestError("toBatchId", { reason: "That batch is archived." });
      if (!mine(found)) throw new ForbiddenError("That batch isn't yours.");
      target = found;
    } else {
      const nb = input.newBatch!;
      const departmentId = nb.departmentId === undefined ? (source.departmentId ?? null) : nb.departmentId;
      await this.institutions.checkDepartment(institutionId, departmentId, a.scope);
      if (await this.store.batches.findByName(institutionId, nb.name)) throw new ConflictError("A batch with this name already exists.");
      target = await this.store.batches.create({ institutionId, name: nb.name, departmentId, academicYear: nb.academicYear, archivedAt: null });
      await this.institutions.audit(actorId, "batch.created", institutionId, "batch", target.id, { name: target.name, departmentId });
    }

    const moved = await this.store.memberships.moveBatch(institutionId, source.id, target.id, input.userIds);
    if (input.archiveSource && !source.archivedAt) await this.store.batches.update(source.id, { archivedAt: new Date() });
    await this.institutions.audit(actorId, "batch.promoted", institutionId, "batch", source.id, {
      to: target.id,
      moved,
      archived: input.archiveSource,
    });
    const counts = await this.store.memberships.countByBatch(institutionId);
    return { moved, to: toBatchView(target, counts[target.id] ?? 0), sourceArchived: input.archiveSource };
  }

  /* ── CSV import ── */

  /**
   * Adds students from a spreadsheet. Each row needs a name and a roll number
   * or an email. People with an account join; others get a new account with a
   * temporary password (returned once) that they change at first sign-in.
   * Rows are checked one by one: a bad row doesn't stop the others.
   */
  async importStudents(actorId: string, institutionId: string, input: ImportStudentsInput): Promise<ImportResult> {
    const a = await this.institutions.access(actorId, institutionId, "people.manage");
    const inst = a.institution;
    const features = featuresWithDefaults(inst.features, inst.type);
    const batches = await this.store.batches.listForInstitution(institutionId);
    const byName = new Map(batches.map((b) => [b.name.toLowerCase(), b]));
    const inScope = (b: BatchRecord) => a.scope.all || a.scope.batchIds.includes(b.id);

    let defaultBatch: BatchRecord | null = null;
    if (input.batchId) {
      defaultBatch = batches.find((b) => b.id === input.batchId) ?? null;
      if (!defaultBatch) throw new BadRequestError("batchId", { reason: "Unknown batch" });
      if (defaultBatch.archivedAt) throw new BadRequestError("batchId", { reason: "That batch is archived." });
      if (!inScope(defaultBatch)) throw new ForbiddenError("That batch isn't yours.");
    }
    const canCreate = input.createBatches && a.scope.all;
    const newBatches = new Map<string, string>(); // lower-case name -> name as written

    type Planned = {
      result: ImportRowResult;
      name: string;
      email: string | null;
      roll: string | null;
      batch: BatchRecord | string | null; // string = a batch this import creates
    };
    const planned: Planned[] = [];
    const seenRoll = new Map<string, number>();
    const seenEmail = new Map<string, number>();

    input.rows.forEach((row, i) => {
      const name = row.name.trim().replace(/\s+/g, " ");
      const roll = row.rollNumber.trim().toUpperCase() || null;
      const email = row.email.trim().toLowerCase() || null;
      const batchName = row.batch.trim();
      const result: ImportRowResult = { row: i + 1, name, rollNumber: roll, email, batchName: batchName || defaultBatch?.name || null, status: "error" };
      const fail = (message: string) => planned.push({ result: { ...result, message }, name, email, roll, batch: null });

      if (name.length < 2 || name.length > 80) return fail("Add the student's full name.");
      if (!roll && !email) return fail("Add a roll number or an email.");
      if (roll && !ROLL_NUMBER_PATTERN.test(roll)) return fail("Roll numbers use up to 40 letters, numbers, - / _ or .");
      if (email && !emailOk(email)) return fail("That email doesn't look right.");
      if (!email && !features.rollNumberLogin) return fail("Add an email: roll-number sign-in isn't switched on for this institution.");
      if (roll && seenRoll.has(roll)) return fail(`Roll number repeats row ${seenRoll.get(roll)}.`);
      if (email && seenEmail.has(email)) return fail(`Email repeats row ${seenEmail.get(email)}.`);

      let batch: BatchRecord | string | null = defaultBatch;
      if (batchName) {
        const found = byName.get(batchName.toLowerCase());
        if (found) {
          if (found.archivedAt) return fail(`${found.name} is archived.`);
          if (!inScope(found)) return fail(`${found.name} isn't one of your batches.`);
          batch = found;
        } else if (canCreate) {
          if (batchName.length > 60) return fail("Batch names are at most 60 characters.");
          if (!newBatches.has(batchName.toLowerCase())) newBatches.set(batchName.toLowerCase(), batchName);
          batch = newBatches.get(batchName.toLowerCase())!;
        } else {
          return fail(`There's no batch called ${batchName}.`);
        }
      }
      if (!batch && !a.scope.all) return fail("Choose one of your batches.");
      if (roll) seenRoll.set(roll, i + 1);
      if (email) seenEmail.set(email, i + 1);
      planned.push({ result: { ...result, batchName: typeof batch === "string" ? batch : (batch?.name ?? null) }, name, email, roll, batch });
    });

    // Look everyone up in three queries.
    const valid = planned.filter((p) => !p.result.message);
    const users = await this.store.users.findByEmails(valid.flatMap((p) => (p.email ? [p.email] : [])));
    const userByEmail = new Map(users.map((u) => [u.email!, u]));
    const [byUser, byRoll] = await Promise.all([
      this.store.memberships.findForUsers(institutionId, users.map((u) => u.id)),
      this.store.memberships.findByRollNumbers(institutionId, valid.flatMap((p) => (p.roll ? [p.roll] : []))),
    ]);
    const memberOfUser = new Map(byUser.map((m) => [m.userId, m]));
    const memberOfRoll = new Map(byRoll.map((m) => [m.rollNumber!, m]));

    let seats = await this.seatsLeft(inst);
    type Action =
      | { kind: "create"; p: Planned }
      | { kind: "join"; p: Planned; user: UserRecord }
      | { kind: "update"; p: Planned; m: MembershipRecord; addBatch: boolean; setRoll: boolean };
    const actions: Action[] = [];
    const batchKey = (b: Planned["batch"]) => (b === null ? null : typeof b === "string" ? `new:${b.toLowerCase()}` : b.id);

    for (const p of valid) {
      const user = p.email ? (userByEmail.get(p.email) ?? null) : null;
      const rollHolder = p.roll ? (memberOfRoll.get(p.roll) ?? null) : null;
      const member = user ? (memberOfUser.get(user.id) ?? null) : rollHolder;
      const fail = (message: string) => Object.assign(p.result, { status: "error" as const, message });

      if (rollHolder && member && rollHolder.id !== member.id) {
        fail(`Roll number ${p.roll} belongs to someone else here.`);
      } else if (rollHolder && !member) {
        fail(`Roll number ${p.roll} belongs to someone else here.`);
      } else if (member) {
        if (member.role !== "student") {
          Object.assign(p.result, { status: "unchanged", message: "Already a staff member here." });
          continue;
        }
        const key = batchKey(p.batch);
        const addBatch = key !== null && (key.startsWith("new:") || !member.batchIds.includes(key));
        const setRoll = Boolean(p.roll) && member.rollNumber !== p.roll;
        p.result.status = addBatch || setRoll ? "updated" : "unchanged";
        if (addBatch || setRoll) actions.push({ kind: "update", p, m: member, addBatch, setRoll });
      } else if (seats < 1) {
        fail("No student seats left. Ask LogixAI to add seats.");
      } else {
        seats--;
        p.result.status = user ? "added" : "created";
        actions.push(user ? { kind: "join", p, user } : { kind: "create", p });
      }
    }

    const finish = (): ImportResult => {
      const counts = { created: 0, added: 0, updated: 0, unchanged: 0, error: 0 } as Record<ImportRowStatus, number>;
      const rows = planned.map((p) => p.result).sort((x, y) => x.row - y.row);
      for (const r of rows) counts[r.status]++;
      const used = new Set(planned.filter((p) => p.result.status !== "error" && typeof p.batch === "string").map((p) => (p.batch as string).toLowerCase()));
      return { dryRun: input.dryRun, counts, rows, batchesCreated: [...newBatches.entries()].filter(([k]) => used.has(k)).map(([, v]) => v) };
    };
    if (input.dryRun) return finish();

    // Create the batches the file names, then apply each row.
    const created = new Map<string, BatchRecord>();
    for (const [key, name] of newBatches) {
      if (!actions.some((x) => typeof x.p.batch === "string" && x.p.batch.toLowerCase() === key)) continue;
      const b = await this.store.batches.create({ institutionId, name, departmentId: null, academicYear: null, archivedAt: null });
      created.set(key, b);
      await this.institutions.audit(actorId, "batch.created", institutionId, "batch", b.id, { name, import: true });
    }
    const batchIdOf = (b: Planned["batch"]) => (b === null ? null : typeof b === "string" ? created.get(b.toLowerCase())!.id : b.id);

    await inChunks(actions, 8, async (action) => {
      const { p } = action;
      const batchId = batchIdOf(p.batch);
      try {
        if (action.kind === "update") {
          await this.store.memberships.update(action.m.id, {
            ...(action.addBatch && batchId ? { batchIds: [...new Set([...action.m.batchIds, batchId])] } : {}),
            ...(action.setRoll ? { rollNumber: p.roll } : {}),
          });
          return;
        }
        let userId: string;
        if (action.kind === "join") {
          userId = action.user.id;
        } else {
          const tempPassword = newTempPassword();
          const user = await this.store.users.create({
            name: p.name,
            email: p.email,
            passwordHash: await hashPassword(tempPassword),
            role: "user",
            managedBy: institutionId,
            mustChangePassword: true,
          });
          userId = user.id;
          p.result.tempPassword = tempPassword;
        }
        await this.store.memberships.create({
          userId,
          institutionId,
          role: "student",
          batchIds: batchId ? [batchId] : [],
          departmentIds: [],
          rollNumber: p.roll,
        });
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        delete p.result.tempPassword;
        Object.assign(p.result, { status: "error", message: "Someone with this email or roll number was added at the same time. Import the row again." });
      }
    });

    const result = finish();
    await this.institutions.audit(actorId, "member.imported", institutionId, "institution", institutionId, { ...result.counts });
    return result;
  }
}
