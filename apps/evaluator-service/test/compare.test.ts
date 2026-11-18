import { describe, expect, it } from "vitest";
import { jsonOutputsMatch, outputsMatch } from "../src/judge/compare.js";

describe("outputsMatch", () => {
  it("ignores trailing spaces, trailing blank lines and Windows line endings", () => {
    expect(outputsMatch("1 2\n3", "1 2  \r\n3\n\n")).toBe(true);
  });

  it("is strict about everything else", () => {
    expect(outputsMatch("1 2", "1  2")).toBe(false);
    expect(outputsMatch("1\n2", "1\n\n2")).toBe(false);
    expect(outputsMatch("abc", "ABC")).toBe(false);
    expect(outputsMatch("1", " 1")).toBe(false);
  });

  it("treats empty output as matching empty expected output", () => {
    expect(outputsMatch("", "\n")).toBe(true);
    expect(outputsMatch("", "x")).toBe(false);
  });
});

describe("jsonOutputsMatch", () => {
  const tol = { absTol: 1e-6, relTol: 1e-6 };

  it("accepts floats within tolerance, element by element", () => {
    expect(jsonOutputsMatch("[[1.0, 2.5], [3, 4]]", "[[1.0000001, 2.5], [3.0, 4]]\n", tol)).toBe(true);
    expect(jsonOutputsMatch("[1.0, 2.0]", "[1.0, 2.01]", tol)).toBe(false);
    expect(jsonOutputsMatch("1e9", "1000000500", tol)).toBe(true); // relative tolerance
  });

  it("is strict about shape, keys, types and strings", () => {
    expect(jsonOutputsMatch("[1, 2]", "[1, 2, 3]", tol)).toBe(false);
    expect(jsonOutputsMatch("[[1, 2]]", "[1, 2]", tol)).toBe(false);
    expect(jsonOutputsMatch('{"a": 1}', '{"a": 1, "b": 2}', tol)).toBe(false);
    expect(jsonOutputsMatch('{"a": 1}', '{"a": 1}', tol)).toBe(true);
    expect(jsonOutputsMatch("true", "1", tol)).toBe(false);
    expect(jsonOutputsMatch('"cat"', '"Cat"', tol)).toBe(false);
    expect(jsonOutputsMatch('"nan"', '"nan"', tol)).toBe(true);
  });

  it("rejects output that isn't JSON", () => {
    expect(jsonOutputsMatch("[1]", "hello\n[1]", tol)).toBe(false);
    expect(jsonOutputsMatch("[1]", "", tol)).toBe(false);
  });
});

describe("metric checker", () => {
  it("scores predictions and reports only the score", async () => {
    const { verdictFor } = await import("../src/judge/judge.js");
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "", timedOut: false, outputLimited: false, durationMs: 5 });
    const accuracy = { kind: "metric" as const, metric: "accuracy" as const, threshold: 0.75 };
    expect(verdictFor(ok("[1, 0, 1, 1]"), "[1, 0, 1, 0]", 1000, accuracy)).toEqual({ status: "SUCCESS", output: "accuracy 0.7500", timeMs: 5 });
    expect(verdictFor(ok("[0, 0, 0, 0]"), "[1, 0, 1, 0]", 1000, accuracy).status).toBe("WA");
    expect(verdictFor(ok("[1, 0]"), "[1, 0, 1, 0]", 1000, accuracy).output).toContain("Expected 4");
    const rmse = { kind: "metric" as const, metric: "rmse" as const, threshold: 1 };
    expect(verdictFor(ok("[1.5, 2.5]"), "[1, 3]", 1000, rmse).status).toBe("SUCCESS");
    expect(verdictFor(ok("[3, 5]"), "[1, 3]", 1000, rmse).status).toBe("WA");
    expect(verdictFor(ok("not json"), "[1, 3]", 1000, rmse).status).toBe("WA");
  });
});
