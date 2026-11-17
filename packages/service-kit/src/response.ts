import type { ApiResponse } from "@logixai/contracts";
import { BaseError } from "./errors";

/** Builds the standard success envelope. */
export function successResponse<T>(data: T, message = "OK"): ApiResponse<T> {
  return { success: true, message, error: {}, data };
}

/** Builds the standard error envelope plus the HTTP status to send it with. */
export function errorResponse(err: unknown): {
  statusCode: number;
  body: ApiResponse<Record<string, never>>;
} {
  if (err instanceof BaseError) {
    return {
      statusCode: err.statusCode,
      body: { success: false, message: err.message, error: err.details, data: {} },
    };
  }
  return {
    statusCode: 500,
    body: {
      success: false,
      message: "Something went wrong",
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
      data: {},
    },
  };
}
