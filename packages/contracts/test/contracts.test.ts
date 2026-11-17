import { describe, expect, it } from "vitest";
import {
  CreateProblemSchema,
  CreateSubmissionSchema,
  SendPayloadSchema,
  SubmissionJobPayloadSchema,
  UpdateProblemSchema,
  deriveSubmissionStatus,
} from "../src";

describe("CreateSubmissionSchema", () => {
  it("normalises the language to upper case", () => {
    const parsed = CreateSubmissionSchema.parse({
      userId: "u1",
      problemId: "p1",
      code: "print(1)",
      language: "python",
    });
    expect(parsed.language).toBe("PYTHON");
  });

  it("rejects unsupported languages and missing fields", () => {
    expect(
      CreateSubmissionSchema.safeParse({
        userId: "u1",
        problemId: "p1",
        code: "",
        language: "rust",
      }).success,
    ).toBe(false);
    expect(CreateSubmissionSchema.safeParse({}).success).toBe(false);
  });
});

describe("CreateProblemSchema", () => {
  it("fills defaults", () => {
    const parsed = CreateProblemSchema.parse({ title: "t", description: "d" });
    expect(parsed).toMatchObject({
      difficulty: "easy",
      testCases: [],
      codeStubs: [],
    });
  });
});

describe("UpdateProblemSchema", () => {
  it("keeps only the fields that were sent (no defaults)", () => {
    expect(UpdateProblemSchema.parse({ title: "New" })).toEqual({ title: "New" });
  });

  it("rejects an empty update and invalid values", () => {
    expect(UpdateProblemSchema.safeParse({}).success).toBe(false);
    expect(UpdateProblemSchema.safeParse({ difficulty: "extreme" }).success).toBe(false);
  });
});

describe("SubmissionJobPayloadSchema", () => {
  it("accepts the payload submission-service produces", () => {
    const payload = {
      abc: {
        code: "x",
        language: "CPP",
        inputCase: "1",
        outputCase: "1",
        userId: "u1",
        submissionId: "abc",
        testCases: [{ input: "1", output: "1", _id: "ignored" }],
      },
    };
    const parsed = SubmissionJobPayloadSchema.parse(payload);
    expect(parsed.abc?.testCases).toEqual([{ input: "1", output: "1" }]);
  });

  it("rejects a non-string submission id (e.g. a raw ObjectId)", () => {
    const payload = {
      abc: {
        code: "x",
        language: "CPP",
        inputCase: "1",
        userId: "u1",
        submissionId: { _bsontype: "ObjectId" },
      },
    };
    expect(SubmissionJobPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe("deriveSubmissionStatus", () => {
  const ok = { status: "SUCCESS", output: "1" } as const;

  it("is Success when every test passes", () => {
    expect(deriveSubmissionStatus([ok, ok])).toBe("Success");
  });

  it("reports the first failure", () => {
    expect(deriveSubmissionStatus([ok, { status: "WA", output: "2" }])).toBe("WA");
    expect(deriveSubmissionStatus([{ status: "ERROR", output: "boom" }])).toBe("RE");
    expect(deriveSubmissionStatus([{ status: "ERROR", output: "TLE" }])).toBe("TLE");
  });

  it("treats an empty result list as a runtime error", () => {
    expect(deriveSubmissionStatus([])).toBe("RE");
  });
});

describe("SendPayloadSchema", () => {
  it("requires the overall status", () => {
    const base = {
      userId: "u1",
      payload: { response: [], userId: "u1", submissionId: "s1" },
    };
    expect(SendPayloadSchema.safeParse(base).success).toBe(false);
    expect(
      SendPayloadSchema.safeParse({
        ...base,
        payload: { ...base.payload, status: "Success" },
      }).success,
    ).toBe(true);
  });
});
