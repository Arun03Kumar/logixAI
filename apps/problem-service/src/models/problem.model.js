const mongoose = require("mongoose");
const { DIFFICULTIES, LANGUAGE_IDS } = require("@logixai/contracts");

// Expected output may legitimately be empty, so no "required" on the strings.
const testCaseSchema = new mongoose.Schema(
  {
    input: { type: String, default: "" },
    output: { type: String, default: "" },
  },
  { _id: false },
);

const problemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Title cannot be empty"],
  },
  description: {
    type: String,
    required: [true, "Description can not be empty"],
  },
  difficulty: {
    type: String,
    enum: DIFFICULTIES,
    required: [true, "difficulty can not be empty"],
    default: "easy",
  },
  /** Shown to students; used by Run and Submit. */
  sampleTestCases: { type: [testCaseSchema], default: [] },
  /** Hidden; used by Submit only. Never returned by the public API. */
  testCases: { type: [testCaseSchema], default: [] },
  codeStubs: [
    {
      language: {
        type: String,
        enum: LANGUAGE_IDS,
        required: true,
      },
      startSnippet: {
        type: String,
      },
      endSnippet: {
        type: String,
      },
      userSnippet: {
        type: String,
      },
    },
  ],
  editorial: {
    type: String,
  },
}, { timestamps: true });

// Public list: newest first, optionally filtered by difficulty (keyset on _id).
problemSchema.index({ difficulty: 1, _id: -1 });

const Problem = mongoose.model("Problem", problemSchema);

module.exports = Problem;
