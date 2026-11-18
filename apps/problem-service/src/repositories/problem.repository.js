const mongoose = require("mongoose");
const { NotFoundError, decodeCursor, toPage } = require("@logixai/service-kit");
const { Problem, AuditEvent } = require("../models");

const isCursor = (v) => typeof v === "string" && mongoose.Types.ObjectId.isValid(v);

class ProblemRepository {
  async createProblem(problemData) {
    return Problem.create({
      title: problemData.title,
      description: problemData.description,
      codeStubs: problemData.codeStubs,
      sampleTestCases: problemData.sampleTestCases ?? [],
      testCases: problemData.testCases ?? [],
      difficulty: problemData.difficulty ?? "easy",
      editorial: problemData.editorial,
    });
  }

  async getProblem(id) {
    return Problem.findById(id);
  }

  /**
   * Newest first, `limit` per page. Keyset pagination on _id stays fast at
   * any depth (no skip). Only list fields are loaded, never the tests.
   */
  async listProblems({ limit, cursor, difficulty }) {
    const after = decodeCursor(cursor, isCursor);
    const filter = {
      ...(difficulty ? { difficulty } : {}),
      ...(after ? { _id: { $lt: new mongoose.Types.ObjectId(after) } } : {}),
    };
    const rows = await Problem.find(filter, { title: 1, description: 1, difficulty: 1 })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return toPage(rows, limit, (last) => String(last._id));
  }

  async deleteProblem(id) {
    const deletedProblem = await Problem.findByIdAndDelete(id);
    if (!deletedProblem) {
      throw new NotFoundError("Problem", id);
    }
    return deletedProblem;
  }

  async updateProblem(id, updates) {
    return Problem.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });
  }

  async recordAudit(event) {
    await AuditEvent.create(event);
  }
}

module.exports = ProblemRepository;
