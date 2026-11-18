import { BadRequestError } from "./errors";

/**
 * Opaque cursors for keyset pagination: the sort key(s) of the last item on a
 * page, JSON-encoded as base64url. Clients pass it back unchanged.
 */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string | undefined, isValid: (v: unknown) => v is T): T | undefined {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (isValid(value)) return value;
  } catch {
    // fall through
  }
  throw new BadRequestError("cursor", { reason: "Invalid page cursor." });
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only tells us
 * whether there is a next page.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (last: T) => unknown) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}
