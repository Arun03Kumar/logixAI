const { NotFoundError } = require("@logixai/service-kit");
const sanitizeMarkdownContent = require("../utils/markdownSanitizer");

class ProblemService {
  constructor(problemRepository, { sanitize = sanitizeMarkdownContent } = {}) {
    this.problemRepository = problemRepository;
    this.sanitize = sanitize;
  }

  async createProblem(problemData) {
    return this.problemRepository.createProblem({
      ...problemData,
      description: this.sanitize(problemData.description),
    });
  }

  async getProblem(id) {
    return this.problemRepository.getProblem(id);
  }

  async getAllProblems() {
    return this.problemRepository.getAllProblems();
  }

  async deleteProblem(id) {
    return this.problemRepository.deleteProblem(id);
  }

  async updateProblem(id, updates) {
    const data = { ...updates };
    if (data.description !== undefined) {
      data.description = this.sanitize(data.description);
    }
    const updated = await this.problemRepository.updateProblem(id, data);
    if (!updated) {
      throw new NotFoundError("Problem", id);
    }
    return updated;
  }
}

module.exports = ProblemService;
