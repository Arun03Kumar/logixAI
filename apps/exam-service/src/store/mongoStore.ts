import mongoose, { Schema, Types } from "mongoose";
import { ATTEMPT_STATUSES, EXAM_STATUSES } from "@logixai/contracts";
import type { AttemptRecord, ExamRecord, Store } from "./types.js";

const opts = { timestamps: { createdAt: true, updatedAt: true }, minimize: false } as const;

const examSchema = new Schema(
  {
    institutionId: { type: String, required: true, index: true },
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
const Exam = mongoose.model("Exam", examSchema);

const attemptSchema = new Schema(
  {
    examId: { type: String, required: true, index: true },
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
const Attempt = mongoose.model("Attempt", attemptSchema);

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
      listForExam: async (examId) =>
        recs<AttemptRecord>(await Attempt.find({ examId }).sort({ startedAt: 1 })),
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
  };
}
