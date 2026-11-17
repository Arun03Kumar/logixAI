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
  it("stores the derived status and pushes it to the user", async () => {
    const submissionRepository = { updateStatus: vi.fn(async () => ({})) };
    const notifyUser = vi.fn(async () => {});

    const status = await processEvaluation(job, { submissionRepository, notifyUser });

    expect(status).toBe("WA");
    expect(submissionRepository.updateStatus).toHaveBeenCalledWith("s1", "WA");
    expect(notifyUser).toHaveBeenCalledWith("u1", { ...job, status: "WA" });
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
