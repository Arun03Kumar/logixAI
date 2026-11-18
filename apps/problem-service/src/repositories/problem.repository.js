const { NotFoundError } = require("@logixai/service-kit");
const { Problem } = require("../models");

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

  async getAllProblems() {
    return Problem.find({});
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
}

module.exports = ProblemRepository;
