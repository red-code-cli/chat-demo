import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppBindings } from "./types.js";

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class GatewayError extends AppError {
  constructor(code: string, message: string, status = 502, options?: ErrorOptions) {
    super(code, message, status, options);
    this.name = "GatewayError";
  }
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export function errorResponse(c: Context<AppBindings>, error: AppError): Response {
  const requestId = c.get("requestId") ?? "unknown";
  const body: ErrorEnvelope = {
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  };
  return c.json(body, error.status as ContentfulStatusCode);
}

export function notFoundResponse(c: Context<AppBindings>): Response {
  return errorResponse(c, new AppError("NOT_FOUND", "Route not found.", 404));
}
