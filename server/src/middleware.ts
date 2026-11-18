import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { ServerConfig } from "./config.js";
import { AppError, errorResponse } from "./errors.js";
import type { Logger } from "./logger.js";
import type { AppBindings } from "./types.js";

export function requestId(): MiddlewareHandler<AppBindings> {
  return createMiddleware<AppBindings>(async (c, next) => {
    const id = randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  });
}

export function requestLogger(logger: Logger): MiddlewareHandler<AppBindings> {
  return createMiddleware<AppBindings>(async (c, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      logger.info("request", {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  });
}

export function securityHeaders(): MiddlewareHandler<AppBindings> {
  return createMiddleware<AppBindings>(async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header("Cache-Control", "no-store");
    await next();
  });
}

export function originGuard(config: ServerConfig): MiddlewareHandler<AppBindings> {
  const allowed = new Set(config.allowedOrigins);
  return createMiddleware<AppBindings>(async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !allowed.has(origin)) {
      return errorResponse(
        c,
        new AppError("ORIGIN_NOT_ALLOWED", "Origin is not allowed.", 403),
      );
    }
    await next();
    return;
  });
}

export function corsMiddleware(config: ServerConfig): MiddlewareHandler<AppBindings> {
  const allowed = new Set(config.allowedOrigins);
  return cors({
    origin: (origin) => (origin !== "" && allowed.has(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
    credentials: false,
  });
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  trustProxy: boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimiter(options: RateLimitOptions): MiddlewareHandler<AppBindings> {
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AppBindings>(async (c, next) => {
    const now = Date.now();
    const key = clientKey(c, options.trustProxy);
    let bucket = buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      return errorResponse(c, new AppError("RATE_LIMITED", "Too many requests.", 429));
    }

    if (buckets.size > 10_000) {
      for (const [bucketKey, entry] of buckets) {
        if (entry.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    await next();
    return;
  });
}

function clientKey(c: Context<AppBindings>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return c.env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export function bearerAuth(config: ServerConfig): MiddlewareHandler<AppBindings> {
  const expectedHash = createHash("sha256").update(config.appAuthToken).digest();

  return createMiddleware<AppBindings>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim();

    if (!token) {
      return unauthorized(c);
    }

    const actualHash = createHash("sha256").update(token).digest();
    if (!timingSafeEqual(expectedHash, actualHash)) {
      return unauthorized(c);
    }

    await next();
    return;
  });
}

function unauthorized(c: Context<AppBindings>): Response {
  c.header("WWW-Authenticate", 'Bearer realm="redcode"');
  return errorResponse(c, new AppError("UNAUTHORIZED", "A valid bearer token is required.", 401));
}
