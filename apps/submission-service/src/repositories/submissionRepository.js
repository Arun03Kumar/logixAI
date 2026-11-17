const Submission = require("../models/submissionModel");

class SubmissionRepository {
  constructor(submissionModel = Submission) {
    this.submissionModel = submissionModel;
  }

  async createSubmission(submission) {
    return this.submissionModel.create(submission);
  }

  async updateStatus(submissionId, status) {
    return this.submissionModel.findByIdAndUpdate(
      submissionId,
      { status },
      { new: true },
    );
  }
}

module.exports = SubmissionRepository;
