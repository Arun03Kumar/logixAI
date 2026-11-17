import { describe, expect, it, vi } from "vitest";
import { NotImplementedError } from "@logixai/service-kit";
import errorHandler from "../src/utils/errorHandler";

function run(err, params = {}) {
  const res = {
    status: vi.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (body) {
      this.body = body;
      return this;
    }),
  };
  errorHandler(err, { params }, res, () => {});
  return res;
}

describe("problem-service errorHandler", () => {
  it("turns a malformed id into 404 instead of 500", () => {
    const castError = Object.assign(new Error("Cast to ObjectId failed"), {
      name: "CastError",
      path: "_id",
      value: "undefined",
    });
    const res = run(castError, { id: "undefined" });
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("turns mongoose validation errors into 400", () => {
    const validation = Object.assign(new Error("invalid"), {
      name: "ValidationError",
      errors: { title: "required" },
    });
    expect(run(validation).statusCode).toBe(400);
  });

  it("keeps the status of known errors", () => {
    expect(run(new NotImplementedError("x")).statusCode).toBe(501);
  });
});
