import {
  BadRequestException,
  HttpStatus,
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from "@nestjs/common";

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
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (issues) =>
      new BadRequestException(`VALIDATION_ERROR: ${issues.map(formatIssue).join("; ")}`),
  });
}
