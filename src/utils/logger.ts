import { ConsoleLogger, ConsoleLoggerOptions, LogLevel } from "@nestjs/common";
import { get_env } from "../helpers/index.js";

type JsonLogOptions = {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: "stdout" | "stderr";
  errorStack?: unknown;
  params?: Record<string, any>;
  error?: Error;
};

export class AppLogger extends ConsoleLogger {
  override getTimestamp(): string {
    return new Date().toISOString();
  }

  protected override getJsonLogObject(message: unknown, options: JsonLogOptions) {
    const logObject = super.getJsonLogObject(message, options);
    logObject.timestamp = new Date().toISOString() as unknown as number;
    return logObject;
  }
}

export function createAppLoggerOptions(
  env: string = get_env("NODE_ENV", "development"),
): ConsoleLoggerOptions {
  const isProduction = env === "production";

  if (isProduction) {
    return {
      json: true,
      colors: false,
      logLevels: ["log", "error", "warn", "fatal"],
    };
  }

  return {
    json: false,
    colors: true,
    logLevels: ["log", "error", "warn", "debug", "verbose", "fatal"],
  };
}

export function createAppLogger(env: string = get_env("NODE_ENV", "development")): AppLogger {
  return new AppLogger(createAppLoggerOptions(env));
}
