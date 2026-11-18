import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.js";
import { parseModelRef } from "../opencode/model.js";
import type { AppBindings } from "../types.js";
import { parseBody, parsePermissionId, parseSessionId, readJson } from "./body.js";
import type { RouteDependencies } from "./deps.js";

const titleSchema = z.string().trim().min(1).max(200);
const createSchema = z
  .object({
    title: titleSchema.optional(),
  })
  .strict();

const modelSchema = z
  .object({
    providerID: z.string().trim().min(1).max(200),
    modelID: z.string().trim().min(1).max(500),
  })
  .strict();

const promptSchema = z
  .object({
    text: z.string().min(1).max(100_000),
    model: modelSchema.optional(),
  })
  .strict();

const permissionSchema = z
  .object({
    response: z.enum(["once", "always", "reject"]),
  })
  .strict();

export function sessionsRoute(deps: RouteDependencies): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/sessions", async (c) => {
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const sessions = await deps.gateway.listSessions(
      directory !== undefined ? { directory } : undefined,
    );
    return c.json({ sessions });
  });

  app.post("/sessions", async (c) => {
    const body = parseBody(createSchema, await readJson(c));
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const session = await deps.gateway.createSession({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(directory !== undefined ? { directory } : {}),
    });
    return c.json({ session }, 201);
  });

  app.get("/sessions/:id", async (c) => {
    const id = parseSessionId(c.req.param("id"));
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const session = await deps.gateway.getSession(
      id,
      directory !== undefined ? { directory } : undefined,
    );
    return c.json({ session });
  });

  app.delete("/sessions/:id", async (c) => {
    const id = parseSessionId(c.req.param("id"));
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const deleted = await deps.gateway.deleteSession(
      id,
      directory !== undefined ? { directory } : undefined,
    );
    if (!deleted) {
      throw new AppError("SESSION_NOT_FOUND", "Session not found.", 404);
    }
    return c.json({ deleted: true });
  });

  app.post("/sessions/:id/prompt", async (c) => {
    const id = parseSessionId(c.req.param("id"));
    const body = parseBody(promptSchema, await readJson(c));
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const model = body.model ?? parseModelRef(deps.config.opencodeModel);

    await deps.gateway.promptAsync({
      sessionID: id,
      text: body.text,
      ...(model !== undefined ? { model } : {}),
      ...(directory !== undefined ? { directory } : {}),
    });

    return c.json({ accepted: true, sessionID: id }, 202);
  });

  app.post("/sessions/:id/abort", async (c) => {
    const id = parseSessionId(c.req.param("id"));
    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const aborted = await deps.gateway.abortSession(
      id,
      directory !== undefined ? { directory } : undefined,
    );
    return c.json({ aborted });
  });

  app.post("/sessions/:id/permissions/:permissionId", async (c) => {
    const sessionID = parseSessionId(c.req.param("id"));
    const permissionID = parsePermissionId(c.req.param("permissionId"));
    const body = parseBody(permissionSchema, await readJson(c));
    const directory = await deps.resolveDirectory(c.req.query("directory"));

    const replied = await deps.gateway.replyPermission({
      sessionID,
      permissionID,
      response: body.response,
      ...(directory !== undefined ? { directory } : {}),
    });

    return c.json({ replied });
  });

  return app;
}
