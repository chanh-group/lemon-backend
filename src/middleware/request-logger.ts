import { Injectable, NestMiddleware, Optional } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { Logger } from "../utils/logger.js";

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor(@Optional() logger?: Logger) {
    this.logger = logger ?? new Logger(RequestLoggerMiddleware.name);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    let logged = false;

    const logResponse = (): void => {
      if (logged) {
        return;
      }
      logged = true;

      const durationMs = Date.now() - startTime;
      const status = res.statusCode || 200;
      const method = req.method || "GET";
      const rawPath = req.originalUrl || req.url || req.path || "/";
      const path = rawPath.split("?")[0] || "/";

      const metadata = { method, path, status, durationMs };

      if (status >= 500) {
        this.logger.error("Incoming request", metadata);
      } else if (status >= 400) {
        this.logger.warn("Incoming request", metadata);
      } else {
        this.logger.log("Incoming request", metadata);
      }
    };

    res.on("finish", logResponse);
    res.on("close", logResponse);

    next();
  }
}
