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
  testCases: z.array(TestCaseSchema),
  codeStubs: z.array(CodeStubSchema),
  editorial: z.string().optional(),
};

/** Body of POST /api/v1/problems */
export const CreateProblemSchema = z.object({
  ...problemFields,
  difficulty: problemFields.difficulty.default("easy"),
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

/** A problem as returned by problem-service. */
export const ProblemSchema = CreateProblemSchema.extend({
  _id: z.string(),
});
export type Problem = z.infer<typeof ProblemSchema>;
