const express = require("express");
const { createAccessTokenVerifier } = require("@logixai/service-kit");
const { ProblemController } = require("../../controllers");
const {
  createRequireAdmin,
  createRequireInternalOrAdmin,
} = require("../../middlewares/auth");
const {
  IDENTITY_JWKS_URL,
  JWT_ISSUER,
  INTERNAL_API_TOKEN,
} = require("../../config/server.config");

const verifier = createAccessTokenVerifier({ jwksUrl: IDENTITY_JWKS_URL, issuer: JWT_ISSUER });
const requireAdmin = createRequireAdmin(verifier);
const requireInternalOrAdmin = createRequireInternalOrAdmin(verifier, INTERNAL_API_TOKEN);

const problemRouter = express.Router();

// Reading problems is public (without hidden tests); changing them needs a platform admin.
problemRouter.get("/ping", ProblemController.pingProblemController);
problemRouter.get("/:id/judge", requireInternalOrAdmin, ProblemController.getProblemForJudge);
problemRouter.get("/:id", ProblemController.getProblem);
problemRouter.get("/", ProblemController.getProblems);
problemRouter.post("/", requireAdmin, ProblemController.addProblem);
problemRouter.delete("/:id", requireAdmin, ProblemController.deleteProblem);
problemRouter.put("/:id", requireAdmin, ProblemController.updateProblem);

module.exports = problemRouter;
