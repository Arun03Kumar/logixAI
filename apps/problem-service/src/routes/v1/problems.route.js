const express = require("express");
const { cacheControl, createAccessTokenVerifier } = require("@logixai/service-kit");
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

/**
 * Public reads may be cached by browsers and a CDN for a short time (admins
 * edit problems, so keep it brief). Express adds a weak ETag and answers 304
 * itself. Signed-in requests are never shared.
 */
const PUBLIC_READ = cacheControl({ maxAge: 30, sMaxAge: 60 });
function publicCache(req, res, next) {
  res.vary("Authorization");
  res.set("Cache-Control", req.headers.authorization ? "private, no-store" : PUBLIC_READ);
  next();
}

// Reading problems is public (without hidden tests); changing them needs a platform admin.
problemRouter.get("/ping", ProblemController.pingProblemController);
problemRouter.get("/:id/judge", requireInternalOrAdmin, ProblemController.getProblemForJudge);
problemRouter.get("/:id", publicCache, ProblemController.getProblem);
problemRouter.get("/", publicCache, ProblemController.getProblems);
problemRouter.post("/", requireAdmin, ProblemController.addProblem);
problemRouter.delete("/:id", requireAdmin, ProblemController.deleteProblem);
problemRouter.put("/:id", requireAdmin, ProblemController.updateProblem);

module.exports = problemRouter;
