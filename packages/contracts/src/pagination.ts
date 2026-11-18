import { z } from "zod";

/** Query string for every paginated list: ?limit=20&cursor=... */
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** A page of results. `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
