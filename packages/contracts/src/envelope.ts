import { z } from "zod";

/**
 * Every HTTP API in LogixAI answers with this envelope:
 * { success, message, error, data }
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  error: unknown;
  data: T;
}

export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean(),
    message: z.string(),
    error: z.unknown(),
    data,
  });
}
