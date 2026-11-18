const { NotFoundError } = require("@logixai/service-kit");
const sanitizeMarkdownContent = require("../utils/markdownSanitizer");

class ProblemService {
  constructor(problemRepository, { sanitize = sanitizeMarkdownContent } = {}) {
    this.problemRepository = problemRepository;
    this.sanitize = sanitize;
  }

  /** Audit records never block the change itself. */
  async audit(actorId, action, problemId, meta = {}) {
    if (!actorId || !this.problemRepository.recordAudit) return;
    await this.problemRepository
      .recordAudit({ actorId, action, institutionId: null, targetType: "problem", targetId: String(problemId), meta })
      .catch(() => {});
  }

  async createProblem(problemData, actorId) {
    const created = await this.problemRepository.createProblem({
      ...problemData,
      description: this.sanitize(problemData.description),
    });
    await this.audit(actorId, "problem.created", created._id, { title: created.title });
    return created;
  }

  async getProblem(id) {
    return this.problemRepository.getProblem(id);
  }

  async listProblems(query) {
    return this.problemRepository.listProblems(query);
  }

  async deleteProblem(id, actorId) {
    const deleted = await this.problemRepository.deleteProblem(id);
    await this.audit(actorId, "problem.deleted", id, { title: deleted?.title });
    return deleted;
  }

  async updateProblem(id, updates, actorId) {
    const data = { ...updates };
    if (data.description !== undefined) {
      data.description = this.sanitize(data.description);
    }
    const updated = await this.problemRepository.updateProblem(id, data);
    if (!updated) {
      throw new NotFoundError("Problem", id);
    }
    await this.audit(actorId, "problem.updated", id, { fields: Object.keys(updates) });
    return updated;
  }
}

module.exports = ProblemService;
