import { describe, expect, it } from "vitest";
import { outputsMatch } from "../src/judge/compare.js";

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
