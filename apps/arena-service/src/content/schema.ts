/**
 * Authoring format for ML Arena content (content/<track>/track.yaml and
 * content/<track>/<topic>.yaml). Everything here, including answers and
 * reference solutions, stays on the server.
 */
import { ACCESS_LEVELS, ARENA_DIFFICULTIES, TRACK_LEVELS } from "@logixai/contracts";
import { z } from "@logixai/service-kit";

const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-words-with-dashes");
const Markdown = z.string().trim().min(1);

export const TrackFileSchema = z.object({
  id: Slug,
  title: z.string().min(1),
  summary: z.string().min(1),
  level: z.enum(TRACK_LEVELS),
  order: z.number().int(),
  /** Topic ids in learning order; each has a <id>.yaml next to this file. */
  topics: z.array(Slug).min(1),
});
export type TrackFile = z.infer<typeof TrackFileSchema>;

const Base = {
  id: Slug,
  title: z.string().min(1).max(120),
  difficulty: z.enum(ARENA_DIFFICULTIES),
  access: z.enum(ACCESS_LEVELS).default("free"),
  tags: z.array(z.string()).default([]),
  prompt: Markdown,
  hints: z.array(Markdown).default([]),
  /** Why the answer is right; shown after solving or revealing. */
  explanation: Markdown,
};

const Option = z.object({ id: z.string().regex(/^[a-z]$/), text: z.string().min(1) });

/** Positional arguments for one call, as JSON values. */
const Args = z.array(z.unknown());
const TestCase = z.object({
  args: Args,
  /** Optional: when given, the build checks the reference solution returns it. */
  expected: z.unknown().optional(),
});

/**
 * Parameter types. `ndarray` / `ndarray_int` arguments arrive as NumPy arrays
 * (float64 / int64); everything else as plain Python values.
 */
export const PARAM_TYPES = ["float", "int", "bool", "str", "list", "dict", "ndarray", "ndarray_int"] as const;

const CodeFields = {
  function: z.object({
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    params: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: z.enum(PARAM_TYPES) })).min(1),
    returns: z.string().min(1),
  }),
  /** What the student starts with (for debug items: the broken code). */
  starter: z.string().min(1),
  /** Reference solution. Must pass every test; the starter must fail at least one. */
  solution: z.string().min(1),
  tests: z.object({
    sample: z.array(TestCase).min(1),
    hidden: z.array(TestCase).default([]),
    /**
     * Python defining `cases(rng)` -> list of argument lists, for extra hidden
     * tests. `rng` is numpy.random.default_rng(<item seed>), so it's repeatable;
     * NumPy is available as `np`.
     */
    generate: z.string().optional(),
  }),
  tolerance: z.object({ abs: z.number().nonnegative(), rel: z.number().nonnegative() }).default({ abs: 1e-6, rel: 1e-6 }),
};

export const ItemSchema = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("mcq_single"), options: z.array(Option).min(2).max(8), answer: z.string() }),
  z.object({ ...Base, type: z.literal("mcq_multi"), options: z.array(Option).min(2).max(8), answer: z.array(z.string()).min(1) }),
  z.object({
    ...Base,
    type: z.literal("numeric"),
    answer: z.number(),
    /** Accepted absolute difference. */
    tolerance: z.number().nonnegative().default(0.01),
    answerFormat: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("output"),
    /** Python snippet; the build runs it and checks `answer` is what it prints. */
    snippet: z.string().min(1),
    answer: z.string(),
  }),
  z.object({ ...Base, type: z.literal("code"), ...CodeFields }),
  z.object({ ...Base, type: z.literal("debug"), ...CodeFields }),
]);
export type ItemSource = z.infer<typeof ItemSchema>;
export type CodeItemSource = Extract<ItemSource, { type: "code" | "debug" }>;

export const TopicFileSchema = z.object({
  id: Slug,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Topic ids (any track) worth knowing first. */
  prerequisites: z.array(Slug).default([]),
  lesson: Markdown,
  items: z.array(ItemSchema).min(1),
});
export type TopicFile = z.infer<typeof TopicFileSchema>;

/** content/tests.generated.json: expected outputs computed by `npm run content:build`. */
export const GeneratedTestsSchema = z.object({
  items: z.record(
    z.string(),
    z.object({
      /** Hash of the item's function, solution and tests when this was built. */
      hash: z.string(),
      sample: z.array(z.object({ args: Args, expected: z.string() })),
      hidden: z.array(z.object({ args: Args, expected: z.string() })),
    }),
  ),
});
export type GeneratedTests = z.infer<typeof GeneratedTestsSchema>;
