const { StatusCodes } = require("http-status-codes");
const {
  CreateProblemSchema,
  UpdateProblemSchema,
} = require("@logixai/contracts");
const {
  BadRequestError,
  NotFoundError,
  successResponse,
} = require("@logixai/service-kit");
const { ProblemService } = require("../services/");
const { ProblemRepository } = require("../repositories");
const {
  toJudgeProblem,
  toProblemSummary,
  toPublicProblem,
} = require("../utils/problemViews");

const problemService = new ProblemService(new ProblemRepository());

/** Parses the request body with a Zod schema or throws a 400 with the issues. */
function parseBody(schema, body, name) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestError(name, parsed.error.issues);
  }
  return parsed.data;
}

function pingProblemController(req, res) {
  return res.json({ message: "problem api is working" });
}

async function addProblem(req, res, next) {
  try {
    const data = parseBody(CreateProblemSchema, req.body, "problem");
    const newproblem = await problemService.createProblem(data);
    return res
      .status(StatusCodes.CREATED)
      .json(successResponse(newproblem, "Successfully created a new problem"));
  } catch (err) {
    next(err);
  }
}

async function getProblem(req, res, next) {
  try {
    const problem = await problemService.getProblem(req.params.id);
    if (!problem) {
      throw new NotFoundError("Problem", req.params.id);
    }
    return res
      .status(StatusCodes.OK)
      .json(successResponse(toPublicProblem(problem), "Successfully fetched a problem"));
  } catch (err) {
    next(err);
  }
}

/** Full problem with hidden tests, for the judge pipeline (internal callers / admins). */
async function getProblemForJudge(req, res, next) {
  try {
    const problem = await problemService.getProblem(req.params.id);
    if (!problem) {
      throw new NotFoundError("Problem", req.params.id);
    }
    return res.status(StatusCodes.OK).json(successResponse(toJudgeProblem(problem)));
  } catch (err) {
    next(err);
  }
}

async function getProblems(req, res, next) {
  try {
    const allProblems = await problemService.getAllProblems();
    return res
      .status(StatusCodes.OK)
      .json(
        successResponse(allProblems.map(toProblemSummary), "Successfully fetched all problems"),
      );
  } catch (err) {
    next(err);
  }
}

async function deleteProblem(req, res, next) {
  try {
    const deletedProblem = await problemService.deleteProblem(req.params.id);
    if (!deletedProblem) {
      throw new NotFoundError("Problem", req.params.id);
    }
    return res
      .status(StatusCodes.OK)
      .json(successResponse(deletedProblem, "Successfully deleted the problem"));
  } catch (err) {
    next(err);
  }
}

async function updateProblem(req, res, next) {
  try {
    const data = parseBody(UpdateProblemSchema, req.body, "problem");
    const updatedProblem = await problemService.updateProblem(
      req.params.id,
      data,
    );
    return res
      .status(StatusCodes.OK)
      .json(successResponse(updatedProblem, "Successfully updated the problem"));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addProblem,
  getProblem,
  getProblemForJudge,
  getProblems,
  deleteProblem,
  updateProblem,
  pingProblemController,
};
