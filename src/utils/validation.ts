import { StandardSchemaValidationPipe } from "@nestjs/common";
import { z } from "zod";
import { BusinessError, type ValidationIssue } from "./errors/business.js";

const ENCODED_KEY_PATTERN = /^[A-Z][A-Z0-9_]*(?:\|.*)?$/;
const PARAM_SEPARATOR = "|";
const PARAM_DELIMITER = "&";
const PARAM_ASSIGNMENT = "=";
const EMAIL_FORMAT = "email";

type SchemaIssue = {
  path?: ReadonlyArray<unknown>;
  message: string;
};

function isPathSegment(segment: unknown): segment is { key: unknown } {
  return typeof segment === "object" && segment !== null && "key" in segment;
}

function formatPath(path: ReadonlyArray<unknown> | undefined): string {
  if (!path?.length) {
    return "";
  }
  return path.map((segment) => String(isPathSegment(segment) ? segment.key : segment)).join(".");
}

function zodIssueMessage(issue: z.core.$ZodRawIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined
        ? "VALIDATION_REQUIRED"
        : vmsg("VALIDATION_TYPE", { expected: String(issue.expected) });
    case "too_small":
      return vmsg("VALIDATION_MIN", { min: String(issue.minimum) });
    case "too_big":
      return vmsg("VALIDATION_MAX", { max: String(issue.maximum) });
    case "invalid_format":
      return issue.format === EMAIL_FORMAT ? "VALIDATION_EMAIL" : "VALIDATION_FORMAT";
    case "invalid_value":
      return "VALIDATION_ENUM";
    default:
      return "VALIDATION_INVALID";
  }
}

z.config({ customError: zodIssueMessage });

export function vmsg(key: string, params?: Record<string, string>): string {
  const entries = params ? Object.entries(params) : [];
  if (entries.length === 0) {
    return key;
  }
  const query = entries
    .map(([name, value]) => `${name}${PARAM_ASSIGNMENT}${encodeURIComponent(value)}`)
    .join(PARAM_DELIMITER);
  return `${key}${PARAM_SEPARATOR}${query}`;
}

export function isEncodedKey(raw: string): boolean {
  return ENCODED_KEY_PATTERN.test(raw);
}

export function decodeValidationMessage(raw: string): {
  message: string;
  params?: Record<string, string>;
} {
  if (!isEncodedKey(raw)) {
    return { message: raw };
  }

  const separatorIndex = raw.indexOf(PARAM_SEPARATOR);
  if (separatorIndex === -1) {
    return { message: raw };
  }

  const message = raw.slice(0, separatorIndex);
  const params: Record<string, string> = {};
  for (const pair of raw.slice(separatorIndex + 1).split(PARAM_DELIMITER)) {
    const assignmentIndex = pair.indexOf(PARAM_ASSIGNMENT);
    if (assignmentIndex === -1) {
      continue;
    }
    params[decodeURIComponent(pair.slice(0, assignmentIndex))] = decodeURIComponent(
      pair.slice(assignmentIndex + 1),
    );
  }

  return Object.keys(params).length > 0 ? { message, params } : { message };
}

export function parseSchemaIssues(issues: readonly SchemaIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: formatPath(issue.path),
    ...decodeValidationMessage(issue.message),
  }));
}

export function standardSchemaPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) => BusinessError.validation(parseSchemaIssues(issues)),
  });
}
