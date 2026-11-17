/**
 * Error hierarchy shared by all services. Anything extending BaseError is
 * turned into a proper HTTP response by the services' error handlers.
 */
export class BaseError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(
    name: string,
    statusCode: number,
    description: string,
    details?: unknown,
  ) {
    super(description);
    this.name = name;
    this.statusCode = statusCode;
    this.details = details ?? {};
  }
}

export class BadRequestError extends BaseError {
  constructor(propertyName: string, details?: unknown) {
    super(
      "BadRequest",
      400,
      `Invalid structure for ${propertyName} provided`,
      details,
    );
  }
}

export class NotFoundError extends BaseError {
  constructor(resourceName?: string, resourceVal?: unknown) {
    super(
      "NotFoundError",
      404,
      `The resource ${resourceName ?? ""} with value ${String(resourceVal ?? "")} not found`,
      { resourceName, resourceVal },
    );
  }
}

export class UnauthorizedError extends BaseError {
  constructor(description = "Sign in to continue") {
    super("Unauthorized", 401, description, {});
  }
}

export class ForbiddenError extends BaseError {
  constructor(description = "You don't have access to this") {
    super("Forbidden", 403, description, {});
  }
}

export class ConflictError extends BaseError {
  constructor(description: string, details?: unknown) {
    super("Conflict", 409, description, details);
  }
}

export class InternalServerError extends BaseError {
  constructor(details?: unknown) {
    super("InternalServerError", 500, "Something went wrong", details);
  }
}

export class NotImplementedError extends BaseError {
  constructor(methodName: string) {
    super("NotImplemented", 501, `${methodName} not implemented`, {});
  }
}
