/**
 * Courses (content/courses.yaml): an ordered path through modules, each a
 * track whose topics are the module's sections. A module can be "planned"
 * (no track yet) and point at existing tracks to practise in the meantime.
 *
 * Adding material later:
 *   - a new section of an existing module: a topic file in the module's
 *     track folder, plus its id in that track.yaml's `topics`;
 *   - a new module: a track folder (area matching the course), then point the
 *     module's entry at it (`track:`) instead of `status: planned`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { AREAS } from "@logixai/contracts";
import { z } from "@logixai/service-kit";
import type { Catalog } from "./catalog.js";

const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-words-with-dashes");

const ModuleSchema = z
  .object({
    number: z.number().int().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    /** The module's track (its topics are the sections). Omit while planned. */
    track: Slug.optional(),
    status: z.enum(["available", "planned"]).default("available"),
    /** Existing tracks worth practising while the module is planned (or alongside it). */
    practice: z.array(Slug).default([]),
  })
  .refine((m) => (m.status === "available") === Boolean(m.track), "available modules need a track; planned modules have none");

export const CoursesFileSchema = z.array(
  z.object({
    id: Slug,
    area: z.enum(AREAS),
    title: z.string().min(1),
    summary: z.string().min(1),
    modules: z.array(ModuleSchema).min(1),
  }),
);
export type CourseConfig = z.infer<typeof CoursesFileSchema>[number];

export const COURSES_FILE = "courses.yaml";

export function loadCourses(dir: string, catalog: Catalog): CourseConfig[] {
  const file = path.join(dir, COURSES_FILE);
  if (!existsSync(file)) return [];
  const parsed = CoursesFileSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const problems: string[] = [];
  const ids = new Set<string>();
  const usedTracks = new Set<string>();
  for (const c of parsed.data) {
    if (ids.has(c.id)) problems.push(`course ${c.id}: duplicate id`);
    ids.add(c.id);
    c.modules.forEach((m, i) => {
      if (m.number !== i + 1) problems.push(`course ${c.id}: module ${i + 1} is numbered ${m.number}`);
      for (const t of [...(m.track ? [m.track] : []), ...m.practice]) {
        const track = catalog.track(t);
        if (!track) problems.push(`course ${c.id} module ${m.number}: unknown track ${t}`);
        else if (track.area !== c.area) problems.push(`course ${c.id} module ${m.number}: track ${t} is in area ${track.area}`);
      }
      if (m.track) {
        if (usedTracks.has(m.track)) problems.push(`course ${c.id}: track ${m.track} is used by two modules`);
        usedTracks.add(m.track);
      }
    });
  }
  if (problems.length) throw new Error(`Invalid courses:\n  - ${problems.join("\n  - ")}`);
  return parsed.data;
}
