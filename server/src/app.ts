import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ServerConfig } from "./config.js";
import { AppError, errorResponse, notFoundResponse } from "./errors.js";
import type { Logger } from "./logger.js";
import {
  bearerAuth,
  corsMiddleware,
  originGuard,
  rateLimiter,
  requestId,
  requestLogger,
  securityHeaders,
} from "./middleware.js";
import type { OpencodeGateway } from "./opencode/types.js";
import { eventsRoute } from "./routes/events.js";
import { healthRoute } from "./routes/health.js";
import { metaRoute } from "./routes/meta.js";
import { sessionsRoute } from "./routes/sessions.js";
import { SseHub } from "./sse.js";
import type { AppBindings } from "./types.js";
import { createWorkspaceResolver } from "./workspace.js";

export interface CreateAppOptions {
  config: ServerConfig;
  gateway: OpencodeGateway;
  logger: Logger;
  sseHeartbeatMs?: number;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  bodyLimitBytes?: number;
}

export interface AppHandle {
  app: Hono<AppBindings>;
  sseHub: SseHub;
}

export function createApp(options: CreateAppOptions): AppHandle {
  const { config, gateway, logger } = options;
  const app = new Hono<AppBindings>();
  const sseHub = new SseHub();
  const resolveDirectory = createWorkspaceResolver(config.workspaceRoot);

  app.use("*", requestId());
  app.use("*", requestLogger(logger));
  app.use("*", securityHeaders());
  app.use("*", originGuard(config));
  app.use("*", corsMiddleware(config));

  app.use(
    "/api/*",
    rateLimiter({
      windowMs: options.rateLimit?.windowMs ?? 60_000,
      max: options.rateLimit?.max ?? 120,
      trustProxy: config.trustProxy,
    }),
  );
  app.use("/api/*", bearerAuth(config));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: options.bodyLimitBytes ?? 1024 * 1024,
      onError: (c) =>
        errorResponse(c, new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413)),
    }),
  );

  const deps = {
    config,
    gateway,
    logger,
    resolveDirectory,
    sseHub,
    sseHeartbeatMs: options.sseHeartbeatMs ?? 15_000,
  };

  app.route("/", healthRoute(gateway));
  app.route("/api/v1", metaRoute(deps));
  app.route("/api/v1", sessionsRoute(deps));
  app.route("/api/v1", eventsRoute(deps));

  app.notFound((c) => notFoundResponse(c));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      const requestIdValue = c.get("requestId");
      const log = error.status >= 500 ? logger.error : logger.warn;
      log("request failed", {
        requestId: requestIdValue,
        code: error.code,
        status: error.status,
        error,
      });
      return errorResponse(c, error);
    }

    logger.error("unhandled error", {
      requestId: c.get("requestId"),
      error,
    });
    return errorResponse(c, new AppError("INTERNAL_ERROR", "Internal server error.", 500));
  });

  return { app, sseHub };
}
