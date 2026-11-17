import { z } from "zod";
import { LANGUAGE_IDS } from "@logixai/languages";

export const LanguageIdSchema = z.enum(LANGUAGE_IDS);

export const TestCaseSchema = z.object({
  input: z.string(),
  output: z.string(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
