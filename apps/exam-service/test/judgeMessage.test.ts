import { describe, expect, it } from "vitest";
import { judgeMessage } from "../src/services/attemptService.js";

describe("judgeMessage", () => {
  it("shows compile errors in full", () => {
    expect(judgeMessage([{ status: "CE", output: "main.cpp:3: error" }], 1)).toBe(
      "Compilation error:\nmain.cpp:3: error",
    );
  });

  it("explains failures on visible examples, with the error for crashes", () => {
    expect(
      judgeMessage(
        [
          { status: "SUCCESS", output: "4" },
          { status: "RE", output: "ZeroDivisionError" },
        ],
        2,
      ),
    ).toBe("Runtime error on example 2.\nZeroDivisionError");
    expect(judgeMessage([{ status: "TLE", output: "" }], 1)).toBe("Time limit exceeded on example 1.");
  });

  it("reveals only the verdict for hidden tests", () => {
    const msg = judgeMessage(
      [
        { status: "SUCCESS", output: "4" },
        { status: "RE", output: "SECRET hidden input 12345" },
      ],
      1,
    );
    expect(msg).toBe("Runtime error on a hidden test.");
  });

  it("says nothing when every test passes, and flags judge failures", () => {
    expect(judgeMessage([{ status: "SUCCESS", output: "4" }], 1)).toBeUndefined();
    expect(judgeMessage([{ status: "ERROR", output: "docker down" }], 1)).toMatch(/judge hit a problem/);
  });
});
