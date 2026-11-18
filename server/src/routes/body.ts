import type { ZodType } from "zod";
import type { Context } from "hono";
import { AppError } from "../errors.js";
import type { AppBindings } from "../types.js";

export async function readJson(c: Context<AppBindings>): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

export function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body.", 400);
  }
  return result.data;
}

export function parseSessionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new AppError("INVALID_SESSION_ID", "Invalid session id.", 400);
  }
  return value;
}

export function parsePermissionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new AppError("INVALID_PERMISSION_ID", "Invalid permission id.", 400);
  }
  return value;
}
