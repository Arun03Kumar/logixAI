const mongoose = require("mongoose");
const {
  LANGUAGE_IDS,
  SUBMISSION_MODES,
  SUBMISSION_STATUSES,
} = require("@logixai/contracts");

const submissionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, "UserId for the submission is missing"],
    },
    problemId: {
      type: String,
      required: [true, "Problem id for the submission is missing"],
    },
    /** The student's code only (not the problem's hidden code around it). */
    code: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      enum: LANGUAGE_IDS,
      required: [true, "Language for the submission is missing"],
    },
    /** "run" = sample tests only, "submit" = all tests. */
    mode: {
      type: String,
      enum: SUBMISSION_MODES,
      default: "submit",
    },
    /** How many of the judged tests were samples (their output may be shown). */
    sampleCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: SUBMISSION_STATUSES,
      default: "Pending",
    },
  },
  { timestamps: true },
);

const Submission = mongoose.model("Submission", submissionSchema);
module.exports = Submission;
