/**
 * ML Arena for institutions: instructors assign tracks to batches and see how
 * each batch is doing; students see what they've been assigned.
 */
import type {
  AssignTrackInput,
  AuditAction,
  AuditEvent,
  BatchReport,
  MyAssignment,
  TrackAssignment,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@logixai/service-kit";
import type { Catalog } from "../content/catalog.js";
import type { IdentityClient, Membership } from "../lib/identity.js";
import type { AssignmentRecord, Page, Store } from "../store/types.js";
import { topicMastery, type ProgressMap } from "./learning.js";

export interface Caller {
  userId: string;
  authorization: string;
}

const STAFF = new Set(["owner", "admin", "instructor"]);

export class InstitutionArenaService {
  constructor(
    private readonly deps: { catalog: Catalog; store: Store; identity: IdentityClient; now?: () => Date },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async member(caller: Caller, institutionId: string): Promise<Membership> {
    const m = await this.deps.identity.getMembership(caller.authorization, institutionId);
    // Same 404 whether the institution doesn't exist or the caller isn't in it.
    if (!m) throw new NotFoundError("Institution", institutionId);
    return m;
  }

  private async staff(caller: Caller, institutionId: string): Promise<Membership> {
    const m = await this.member(caller, institutionId);
    if (!STAFF.has(m.role)) throw new ForbiddenError("Only instructors and admins can manage ML Arena for the institution.");
    return m;
  }

  private view(a: AssignmentRecord): TrackAssignment {
    return {
      id: a.id,
      institutionId: a.institutionId,
      batchId: a.batchId,
      trackId: a.trackId,
      trackTitle: this.deps.catalog.track(a.trackId)?.title ?? "Removed track",
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      assignedBy: a.assignedBy,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** Staff see every assignment; students only those for their own batches. */
  async list(caller: Caller, institutionId: string): Promise<TrackAssignment[]> {
    const m = await this.member(caller, institutionId);
    const rows = await this.deps.store.assignments.listForInstitution(
      institutionId,
      STAFF.has(m.role) ? undefined : m.batchIds,
    );
    return rows.map((a) => this.view(a));
  }

  async assign(caller: Caller, institutionId: string, input: AssignTrackInput): Promise<TrackAssignment> {
    await this.staff(caller, institutionId);
    const track = this.deps.catalog.track(input.trackId);
    if (!track) throw new BadRequestError("assignment", { reason: "That track doesn't exist." });
    const batches = await this.deps.identity.listBatches(caller.authorization, institutionId);
    const batch = batches.find((b) => b.id === input.batchId);
    if (!batch) throw new BadRequestError("assignment", { reason: "That batch doesn't exist in this institution." });
    let created: AssignmentRecord;
    try {
      created = await this.deps.store.assignments.create({
        institutionId,
        batchId: batch.id,
        trackId: track.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assignedBy: caller.userId,
        createdAt: this.now(),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError(`${track.title} is already assigned to ${batch.name}.`);
      throw err;
    }
    await this.audit(caller, "arena.track_assigned", institutionId, created.id, {
      trackId: track.id,
      batchId: batch.id,
      batchName: batch.name,
    });
    return this.view(created);
  }

  async unassign(caller: Caller, institutionId: string, assignmentId: string): Promise<void> {
    await this.staff(caller, institutionId);
    const a = await this.deps.store.assignments.get(assignmentId);
    if (!a || a.institutionId !== institutionId) throw new NotFoundError("Assignment", assignmentId);
    await this.deps.store.assignments.delete(a.id);
    await this.audit(caller, "arena.track_unassigned", institutionId, a.id, { trackId: a.trackId, batchId: a.batchId });
  }

  /** Tracks assigned to any of the caller's batches, with their own progress. */
  async mine(caller: Caller): Promise<MyAssignment[]> {
    const memberships = await this.deps.identity.myMemberships(caller.authorization);
    const progress: ProgressMap = new Map(
      (await this.deps.store.progress.listForUser(caller.userId)).map((r) => [r.itemId, r]),
    );
    const out: MyAssignment[] = [];
    for (const m of memberships) {
      if (!m.batchIds.length) continue;
      for (const a of await this.deps.store.assignments.listForInstitution(m.institution.id, m.batchIds)) {
        const track = this.deps.catalog.track(a.trackId);
        if (!track) continue;
        const items = track.topics.flatMap((t) => t.items);
        out.push({
          ...this.view(a),
          institutionName: m.institution.name,
          itemCount: items.length,
          solvedCount: items.filter((i) => progress.get(i.id)?.status === "solved").length,
          mastery: topicMastery(items, progress),
        });
      }
    }
    // Soonest due first, undated last.
    return out.sort((x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999"));
  }

  /** How a batch is doing on a track: per student, and per topic across the batch. */
  async report(caller: Caller, institutionId: string, batchId: string, trackId: string): Promise<BatchReport> {
    await this.staff(caller, institutionId);
    const track = this.deps.catalog.track(trackId);
    if (!track) throw new NotFoundError("Track", trackId);
    const members = (await this.deps.identity.listBatchMembers(caller.authorization, institutionId, batchId)).filter(
      (m) => m.role === "student",
    );
    const userIds = members.map((m) => m.userId);
    const items = track.topics.flatMap((t) => t.items);
    const [rows, stats] = await Promise.all([
      userIds.length ? this.deps.store.progress.listForUsers(userIds, items.map((i) => i.id)) : [],
      userIds.length ? this.deps.store.stats.getMany(userIds) : [],
    ]);
    const byUser = new Map<string, ProgressMap>();
    for (const r of rows) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, new Map());
      byUser.get(r.userId)!.set(r.itemId, r);
    }
    const xp = new Map(stats.map((s) => [s.userId, s.xp]));

    const reportRows = members.map((m) => {
      const p = byUser.get(m.userId) ?? new Map();
      const last = [...p.values()].reduce<Date | null>(
        (acc, r) => (!acc || r.lastActivityAt > acc ? r.lastActivityAt : acc),
        null,
      );
      return {
        userId: m.userId,
        name: m.name,
        email: m.email,
        solvedCount: items.filter((i) => p.get(i.id)?.status === "solved").length,
        mastery: topicMastery(items, p),
        topicMastery: track.topics.map((t) => topicMastery(t.items, p)),
        xp: xp.get(m.userId) ?? 0,
        lastActiveAt: last ? last.toISOString() : null,
      };
    });
    reportRows.sort((a, b) => b.mastery - a.mastery || a.name.localeCompare(b.name));
    const avg = (i: number) =>
      reportRows.length ? Math.round((reportRows.reduce((s, r) => s + r.topicMastery[i]!, 0) / reportRows.length) * 100) / 100 : 0;

    return {
      batchId,
      track: { id: track.id, title: track.title, itemCount: items.length },
      topics: track.topics.map((t) => ({ id: t.id, title: t.title })),
      topicAverages: track.topics.map((_, i) => avg(i)),
      rows: reportRows,
    };
  }

  async auditLog(caller: Caller, institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>> {
    const m = await this.member(caller, institutionId);
    if (m.role !== "owner" && m.role !== "admin") throw new ForbiddenError("Only admins can see the audit log.");
    return this.deps.store.audit.pageForInstitution(institutionId, query);
  }

  /** Best effort: a failed audit write never fails the change itself. */
  private async audit(caller: Caller, action: AuditAction, institutionId: string, targetId: string, meta: Record<string, unknown>) {
    await this.deps.store.audit
      .record({ actorId: caller.userId, action, institutionId, targetType: "track_assignment", targetId, meta })
      .catch(() => {});
  }
}
