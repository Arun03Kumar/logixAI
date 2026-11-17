const express = require("express");
const { createAccessTokenVerifier } = require("@logixai/service-kit");
const { ProblemController } = require("../../controllers");
const { createRequireAdmin } = require("../../middlewares/auth");
const { IDENTITY_JWKS_URL, JWT_ISSUER } = require("../../config/server.config");

const requireAdmin = createRequireAdmin(
  createAccessTokenVerifier({ jwksUrl: IDENTITY_JWKS_URL, issuer: JWT_ISSUER }),
);

const problemRouter = express.Router();

// Reading problems is public; changing them needs a platform admin.
problemRouter.get("/ping", ProblemController.pingProblemController);
problemRouter.get("/:id", ProblemController.getProblem);
problemRouter.get("/", ProblemController.getProblems);
problemRouter.post("/", requireAdmin, ProblemController.addProblem);
problemRouter.delete("/:id", requireAdmin, ProblemController.deleteProblem);
problemRouter.put("/:id", requireAdmin, ProblemController.updateProblem);

module.exports = problemRouter;
