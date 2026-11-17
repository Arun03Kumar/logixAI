const mongoose = require("mongoose");
const { LANGUAGE_IDS, SUBMISSION_STATUSES } = require("@logixai/contracts");

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
    code: {
      type: String,
      required: [true, "Code for the submission is missing"],
    },
    language: {
      type: String,
      enum: LANGUAGE_IDS,
      required: [true, "Language for the submission is missing"],
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
