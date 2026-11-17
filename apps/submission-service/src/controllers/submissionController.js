const { CreateSubmissionSchema } = require("@logixai/contracts");
const { BadRequestError, successResponse } = require("@logixai/service-kit");

async function pingRequest(req, res) {
  const data = await this.submissionService.pingCheck();
  return res.send({ data });
}

async function createSubmission(req, res) {
  // The user comes from the verified access token, never from the body.
  const parsed = CreateSubmissionSchema.safeParse({
    ...(req.body ?? {}),
    userId: req.auth.sub,
  });
  if (!parsed.success) {
    throw new BadRequestError("submission", parsed.error.issues);
  }

  const response = await this.submissionService.addSubmission(parsed.data);
  return res
    .status(201)
    .send(successResponse(response, "Created submission successfully"));
}

module.exports = { pingRequest, createSubmission };
