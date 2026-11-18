import mongoose, { Schema, Types } from "mongoose";
import { ATTEMPT_STATUSES, AUDIT_ACTIONS, EXAM_STATUSES, type AuditEvent } from "@logixai/contracts";
import { decodeCursor, toPage } from "@logixai/service-kit";
import type { AttemptRecord, AttemptRow, ExamRecord, Store } from "./types.js";

const opts = { timestamps: { createdAt: true, updatedAt: true }, minimize: false } as const;

const examSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    title: { type: String, required: true },
    instructions: { type: String, default: "" },
    durationMinutes: { type: Number, required: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    batchIds: { type: [String], default: [] },
    // Validated by the contracts' Zod schemas before it gets here.
    settings: { type: Schema.Types.Mixed, required: true },
    questions: { type: [Schema.Types.Mixed], default: [] },
    status: { type: String, enum: EXAM_STATUSES, default: "draft" },
    createdBy: { type: String, required: true },
    publishedAt: { type: Date, default: null },
  },
  opts,
);
// The institution's exam list, newest first.
examSchema.index({ institutionId: 1, startsAt: -1, createdAt: -1 });
const Exam = mongoose.model("Exam", examSchema);

const attemptSchema = new Schema(
  {
    examId: { type: String, required: true },
    institutionId: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ATTEMPT_STATUSES, required: true },
    startedAt: { type: Date, required: true },
    deadline: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    questionOrder: { type: [String], default: [] },
    optionOrder: { type: Schema.Types.Mixed, default: {} },
    answers: { type: Schema.Types.Mixed, default: {} },
    scores: { type: Schema.Types.Mixed, default: null },
    score: { type: Number, default: null },
    maxScore: { type: Number, required: true },
    proctorEvents: { type: [{ _id: false, type: { type: String }, at: Date }], default: [] },
  },
  opts,
);
attemptSchema.index({ examId: 1, userId: 1 }, { unique: true });
attemptSchema.index({ status: 1, deadline: 1 });
// Results table: best score first, keyset-paged.
attemptSchema.index({ examId: 1, score: -1, _id: 1 });
const Attempt = mongoose.model("Attempt", attemptSchema);

const auditSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actorId: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    institutionId: { type: String, default: null },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: "audit_events", versionKey: false, minimize: false },
);
auditSchema.index({ institutionId: 1, _id: -1 });
auditSchema.index({ targetId: 1, _id: -1 });
const AuditEventModel = mongoose.model("AuditEvent", auditSchema);

/** Results cursor: [score of the last row (null = unscored), its _id]. */
type ResultCursor = [number | null, string];
const isResultCursor = (v: unknown): v is ResultCursor =>
  Array.isArray(v) &&
  v.length === 2 &&
  (v[0] === null || typeof v[0] === "number") &&
  typeof v[1] === "string" &&
  Types.ObjectId.isValid(v[1]);
const isIdCursor = (v: unknown): v is string => typeof v === "string" && Types.ObjectId.isValid(v);

function rec<T>(doc: unknown): T {
  const { _id, __v: _v, updatedAt: _u, ...rest } = (
    doc as { toObject(): Record<string, unknown> }
  ).toObject();
  return { id: String(_id), ...rest } as T;
}
const recOrNull = <T>(doc: unknown): T | null => (doc ? rec<T>(doc) : null);
const recs = <T>(docs: unknown[]): T[] => docs.map((d) => rec<T>(d));
const isId = (id: string) => Types.ObjectId.isValid(id);

export function createMongoStore(): Store {
  return {
    exams: {
      create: async (data) => rec<ExamRecord>(await Exam.create(data)),
      findById: async (id) => (isId(id) ? recOrNull<ExamRecord>(await Exam.findById(id)) : null),
      listForInstitution: async (institutionId) =>
        recs<ExamRecord>(await Exam.find({ institutionId }).sort({ startsAt: -1, createdAt: -1 })),
      update: async (id, patch) =>
        isId(id) ? recOrNull<ExamRecord>(await Exam.findByIdAndUpdate(id, patch, { new: true })) : null,
      delete: async (id) => {
        await Exam.deleteOne({ _id: id });
      },
    },
    attempts: {
      create: async (data) => rec<AttemptRecord>(await Attempt.create(data)),
      findById: async (id) =>
        isId(id) ? recOrNull<AttemptRecord>(await Attempt.findById(id)) : null,
      find: async (examId, userId) => recOrNull<AttemptRecord>(await Attempt.findOne({ examId, userId })),
      pageForExam: async (examId, { limit, cursor }) => {
        const after = decodeCursor(cursor, isResultCursor);
        let match: Record<string, unknown> = { examId };
        if (after) {
          const [score, id] = after;
          const afterId = { _id: { $gt: new Types.ObjectId(id) } };
          // A descending sort puts null scores last, so after a null only nulls remain.
          match =
            score === null
              ? { examId, score: null, ...afterId }
              : { examId, $or: [{ score: { $lt: score } }, { score, ...afterId }, { score: null }] };
        }
        const rows = await Attempt.aggregate<Omit<AttemptRow, "id"> & { _id: Types.ObjectId }>([
          { $match: match },
          { $sort: { score: -1, _id: 1 } },
          { $limit: limit + 1 },
          {
            $project: {
              userId: 1,
              status: 1,
              startedAt: 1,
              submittedAt: 1,
              score: 1,
              maxScore: 1,
              proctorEventCount: { $size: { $ifNull: ["$proctorEvents", []] } },
            },
          },
        ]);
        const page = toPage(rows, limit, (last) => [last.score ?? null, String(last._id)]);
        return {
          items: page.items.map(({ _id, ...row }) => ({ ...row, score: row.score ?? null, id: String(_id) })),
          nextCursor: page.nextCursor,
        };
      },
      summarizeExam: async (examId) => {
        const finalScore = { $cond: [{ $ne: ["$status", "in_progress"] }, "$score", null] };
        const [row] = await Attempt.aggregate([
          { $match: { examId } },
          {
            $group: {
              _id: null,
              attempts: { $sum: 1 },
              inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
              flagged: {
                $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$proctorEvents", []] } }, 0] }, 1, 0] },
              },
              averageScore: { $avg: finalScore },
              highestScore: { $max: finalScore },
              lowestScore: { $min: finalScore },
            },
          },
        ]);
        const attempts: number = row?.attempts ?? 0;
        const inProgress: number = row?.inProgress ?? 0;
        return {
          attempts,
          submitted: attempts - inProgress,
          inProgress,
          flagged: row?.flagged ?? 0,
          averageScore: row?.averageScore == null ? null : Math.round(row.averageScore * 100) / 100,
          highestScore: row?.highestScore ?? null,
          lowestScore: row?.lowestScore ?? null,
        };
      },
      listForUser: async (userId, examIds) =>
        recs<AttemptRecord>(await Attempt.find({ userId, examId: { $in: examIds } })),
      countForExam: (examId) => Attempt.countDocuments({ examId }),
      saveAnswer: async (id, questionId, answer, deadlineAfter) => {
        // Field-level $set keeps the existing judge record unless the caller sets one.
        const set: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(answer)) {
          set[`answers.${questionId}.${key}`] = value;
        }
        const res = await Attempt.updateOne(
          { _id: id, status: "in_progress", deadline: { $gt: deadlineAfter } },
          { $set: set },
        );
        return res.matchedCount === 1;
      },
      setJudge: async (id, questionId, judge) => {
        const res = await Attempt.updateOne(
          { _id: id, [`answers.${questionId}.judge.submissionId`]: judge.submissionId },
          { $set: { [`answers.${questionId}.judge`]: judge } },
        );
        return res.matchedCount === 1;
      },
      pushEvent: async (id, event, max) => {
        await Attempt.updateOne(
          { _id: id, status: "in_progress" },
          { $push: { proctorEvents: { $each: [event], $slice: -max } } },
        );
      },
      finalize: async (id, patch) => {
        const res = await Attempt.updateOne({ _id: id, status: "in_progress" }, { $set: patch });
        return res.modifiedCount === 1;
      },
      setScores: async (id, scores, score) => {
        await Attempt.updateOne({ _id: id }, { $set: { scores, score } });
      },
      listExpiredInProgress: async (now) =>
        recs<AttemptRecord>(await Attempt.find({ status: "in_progress", deadline: { $lt: now } }).limit(500)),
    },
    audit: {
      record: async (event) => {
        await AuditEventModel.create(event);
      },
      pageForInstitution: async (institutionId, { limit, cursor }) => {
        const after = decodeCursor(cursor, isIdCursor);
        const docs = await AuditEventModel.find({
          institutionId,
          ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
        })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
        const page = toPage(docs, limit, (last) => String(last._id));
        return {
          items: page.items.map(({ _id, at, ...rest }) => ({
            ...(rest as Omit<AuditEvent, "id" | "at">),
            id: String(_id),
            at: at.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      },
    },
  };
}
