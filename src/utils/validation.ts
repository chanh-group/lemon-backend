import {
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from "@nestjs/common";
import { BusinessError } from "./errors/business.js";

type SchemaIssues = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions["exceptionFactory"]>
>[0];

function formatIssue(issue: SchemaIssues[number]): string {
  if (issue.path?.length) {
    const path = issue.path
      .map((segment) => String(typeof segment === "object" ? segment.key : segment))
      .join(".");
    return `${path}: ${issue.message}`;
  }
  return issue.message;
}

export function standardSchemaPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) => BusinessError.validation(issues.map(formatIssue).join("; ")),
  });
}
