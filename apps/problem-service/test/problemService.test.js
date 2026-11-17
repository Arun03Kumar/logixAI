import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@logixai/service-kit";
import ProblemService from "../src/services/problem.service";

const sanitize = (text) => `clean(${text})`;

describe("ProblemService", () => {
  it("sanitizes the description on create", async () => {
    const repo = { createProblem: vi.fn(async (p) => p) };
    const service = new ProblemService(repo, { sanitize });
    const created = await service.createProblem({ title: "t", description: "d" });
    expect(created.description).toBe("clean(d)");
  });

  it("updates only the fields given, sanitizing a new description", async () => {
    const repo = { updateProblem: vi.fn(async (id, data) => ({ _id: id, ...data })) };
    const service = new ProblemService(repo, { sanitize });

    await service.updateProblem("p1", { title: "New" });
    expect(repo.updateProblem).toHaveBeenLastCalledWith("p1", { title: "New" });

    await service.updateProblem("p1", { description: "d" });
    expect(repo.updateProblem).toHaveBeenLastCalledWith("p1", {
      description: "clean(d)",
    });
  });

  it("throws NotFound when updating a missing problem", async () => {
    const repo = { updateProblem: vi.fn(async () => null) };
    const service = new ProblemService(repo, { sanitize });
    await expect(service.updateProblem("nope", { title: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
