import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const DifficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const CodeStubSchema = z.object({
  language: LanguageIdSchema,
  startSnippet: z.string().optional(),
  endSnippet: z.string().optional(),
  userSnippet: z.string().optional(),
});
export type CodeStub = z.infer<typeof CodeStubSchema>;

const problemFields = {
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  difficulty: DifficultySchema,
  /** Shown to students as examples; used by "Run" and by "Submit". */
  sampleTestCases: z.array(TestCaseSchema).max(10),
  /** Hidden tests; used only by "Submit". Never sent to the browser. */
  testCases: z.array(TestCaseSchema).max(200),
  codeStubs: z.array(CodeStubSchema),
  editorial: z.string().optional(),
};

/** Body of POST /api/v1/problems */
export const CreateProblemSchema = z.object({
  ...problemFields,
  difficulty: problemFields.difficulty.default("easy"),
  sampleTestCases: problemFields.sampleTestCases.default([]),
  testCases: problemFields.testCases.default([]),
  codeStubs: problemFields.codeStubs.default([]),
});
export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;

/**
 * Body of PUT /api/v1/problems/:id. Every field is optional and has no
 * default, so omitted fields are left untouched.
 */
export const UpdateProblemSchema = z
  .object(problemFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type UpdateProblemInput = z.infer<typeof UpdateProblemSchema>;

/** A problem as stored (includes hidden tests and hidden code). */
export const ProblemSchema = CreateProblemSchema.extend({
  _id: z.string(),
});
export type Problem = z.infer<typeof ProblemSchema>;

type TestCaseList = { input: string; output: string }[];

/** How many tests of a legacy problem (no samples marked) are treated as samples. */
export const LEGACY_SAMPLE_COUNT = 2;

/**
 * Sample and hidden tests of a problem. Problems created before samples
 * existed only have `testCases`; their first LEGACY_SAMPLE_COUNT tests
 * become the samples so nothing changes for students.
 */
export function splitTests(problem: {
  sampleTestCases?: TestCaseList | null;
  testCases?: TestCaseList | null;
}): { samples: TestCaseList; hidden: TestCaseList } {
  const all = problem.testCases ?? [];
  if (problem.sampleTestCases && problem.sampleTestCases.length > 0) {
    return { samples: problem.sampleTestCases, hidden: all };
  }
  return { samples: all.slice(0, LEGACY_SAMPLE_COUNT), hidden: all.slice(LEGACY_SAMPLE_COUNT) };
}
