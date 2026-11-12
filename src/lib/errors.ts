/**
 * Domain errors. Messages are safe to show to users: they never contain record
 * contents, credentials or identifiers beyond what the caller already supplied.
 */

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Not signed in, or the session is invalid/expired. */
export class AuthenticationError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message);
  }
}

/** Signed in, but the role may not perform this action at all. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

/**
 * The record does not exist OR the actor may not see it. These are deliberately
 * indistinguishable so that IDs of other clients' records cannot be probed.
 */
export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(
    public readonly fieldErrors: Record<string, string[]>,
    message = "Please correct the highlighted fields.",
  ) {
    super(message);
  }
}

/** An external integration has not been configured or implemented yet. */
export class IntegrationNotConfiguredError extends AppError {
  constructor(integration: string, detail: string) {
    super(`${integration} is not available: ${detail}`);
  }
}
