import { describe, expect, it, vi } from "vitest";
import processEvaluation from "../src/workers/processEvaluation";

const job = {
  userId: "u1",
  submissionId: "s1",
  response: [
    { status: "SUCCESS", output: "1" },
    { status: "WA", output: "3" },
  ],
};

describe("processEvaluation", () => {
  it("stores the derived status and pushes it to the user, hiding hidden-test output", async () => {
    const submissionRepository = {
      updateStatus: vi.fn(async () => ({ sampleCount: 1, mode: "submit" })),
    };
    const notifyUser = vi.fn(async () => {});

    const status = await processEvaluation(job, { submissionRepository, notifyUser });

    expect(status).toBe("WA");
    expect(submissionRepository.updateStatus).toHaveBeenCalledWith("s1", "WA");
    expect(notifyUser).toHaveBeenCalledWith("u1", {
      ...job,
      // Test 2 is hidden: its verdict is shown, its output isn't.
      response: [
        { status: "SUCCESS", output: "1" },
        { status: "WA", output: "" },
      ],
      status: "WA",
      mode: "submit",
      sampleCount: 1,
    });
  });

  it("keeps compile errors visible", async () => {
    const ce = { userId: "u1", submissionId: "s1", response: [{ status: "CE", output: "error: ';'" }] };
    const notifyUser = vi.fn(async () => {});
    await processEvaluation(ce, {
      submissionRepository: { updateStatus: async () => ({ sampleCount: 0, mode: "submit" }) },
      notifyUser,
    });
    expect(notifyUser.mock.calls[0][1]).toMatchObject({ status: "CE", response: [{ output: "error: ';'" }] });
  });

  it("does not fail the job when the user is no longer connected", async () => {
    const submissionRepository = { updateStatus: vi.fn(async () => ({})) };
    const notifyUser = vi.fn(async () => {
      throw new Error("Request failed with status code 404");
    });
    const logger = { error: vi.fn() };

    await expect(
      processEvaluation(job, { submissionRepository, notifyUser, logger }),
    ).resolves.toBe("WA");
    expect(logger.error).toHaveBeenCalled();
  });

  it("rejects malformed job data instead of storing garbage", async () => {
    const submissionRepository = { updateStatus: vi.fn() };
    await expect(
      processEvaluation({ userId: "u1" }, { submissionRepository, notifyUser: vi.fn() }),
    ).rejects.toThrow();
    expect(submissionRepository.updateStatus).not.toHaveBeenCalled();
  });
});
