import { BusinessError } from "./business.js";

type PostgresError = {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
};

function isPostgresError(error: unknown): error is PostgresError {
  return typeof error === "object" && error !== null && "code" in error;
}

export function isUniqueViolation(error: unknown, constraintPattern: string): boolean {
  if (!isPostgresError(error) || error.code !== "23505") {
    return false;
  }

  return typeof error.constraint === "string" && error.constraint.includes(constraintPattern);
}

export function mapUniqueViolation(
  error: unknown,
  mappings: ReadonlyArray<readonly [pattern: string, value: string]>,
): unknown {
  if (!isPostgresError(error) || error.code !== "23505") {
    return error;
  }

  const constraint = typeof error.constraint === "string" ? error.constraint : "";
  const detail = typeof error.detail === "string" ? error.detail : "";
  const match = mappings.find(([pattern]) => {
    return constraint.includes(pattern) || detail.includes(pattern);
  });

  if (!match) {
    return error;
  }

  const [pattern, value] = match;
  return new BusinessError("CONFLICT", undefined, `${pattern} already exists: ${value}`);
}
