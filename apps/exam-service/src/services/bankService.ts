import type {
  AuditAction,
  BankQuery,
  BankQuestionInput,
  BankQuestionView,
} from "@logixai/contracts";
import { ForbiddenError, NotFoundError } from "@logixai/service-kit";
import type { BankQuestionRecord, Page } from "../store/types.js";
import { requireCapability, requireMember, type Caller, type Deps } from "./context.js";

function toView(row: BankQuestionRecord): BankQuestionView {
  return {
    id: row.id,
    institutionId: row.institutionId,
    question: row.question,
    topic: row.topic,
    tags: row.tags,
    difficulty: row.difficulty,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The institution's shared question bank. Everyone who sets exams can browse
 * it and add to it; questions are copied into an exam, so editing the bank
 * never changes an exam that already has the question.
 */
export class BankService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, institutionId: string, query: BankQuery): Promise<Page<BankQuestionView>> {
    await this.member(caller, institutionId);
    const page = await this.deps.store.bank.page(institutionId, query);
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }

  async create(caller: Caller, institutionId: string, input: BankQuestionInput): Promise<BankQuestionView> {
    await this.member(caller, institutionId);
    const row = await this.deps.store.bank.create({
      institutionId,
      question: input.question,
      topic: input.topic,
      tags: [...new Set(input.tags)],
      difficulty: input.difficulty,
      createdBy: caller.userId,
    });
    await this.audit(caller, "bank_question.created", row);
    return toView(row);
  }

  async update(caller: Caller, institutionId: string, id: string, input: BankQuestionInput): Promise<BankQuestionView> {
    const row = await this.own(caller, institutionId, id);
    const updated = await this.deps.store.bank.update(row.id, {
      question: input.question,
      topic: input.topic,
      tags: [...new Set(input.tags)],
      difficulty: input.difficulty,
    });
    if (!updated) throw new NotFoundError("Question", id);
    await this.audit(caller, "bank_question.updated", updated);
    return toView(updated);
  }

  async remove(caller: Caller, institutionId: string, id: string): Promise<void> {
    const row = await this.own(caller, institutionId, id);
    await this.deps.store.bank.delete(row.id);
    await this.audit(caller, "bank_question.deleted", row);
  }

  private async member(caller: Caller, institutionId: string) {
    const membership = await requireMember(this.deps, caller, institutionId);
    requireCapability(membership, "tests.manage");
    return membership;
  }

  /** The author, or staff with institution-wide scope, may change a bank question. */
  private async own(caller: Caller, institutionId: string, id: string): Promise<BankQuestionRecord> {
    const membership = await this.member(caller, institutionId);
    const row = await this.deps.store.bank.findById(id);
    if (!row || row.institutionId !== institutionId) throw new NotFoundError("Question", id);
    if (row.createdBy !== caller.userId && !membership.scope.all) {
      throw new ForbiddenError("Only the person who added this question, or an admin, can change it.");
    }
    return row;
  }

  private async audit(caller: Caller, action: AuditAction, row: BankQuestionRecord) {
    await this.deps.store.audit
      .record({
        actorId: caller.userId,
        action,
        institutionId: row.institutionId,
        targetType: "bank_question",
        targetId: row.id,
        meta: { type: row.question.type, topic: row.topic },
      })
      .catch(() => {});
  }
}
