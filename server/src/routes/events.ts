import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AppError } from "../errors.js";
import { eventSessionId } from "../opencode/events.js";
import type { AppBindings } from "../types.js";
import type { RouteDependencies } from "./deps.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function eventsRoute(deps: RouteDependencies): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/events", async (c) => {
    const sessionID = c.req.query("session");
    if (sessionID !== undefined && !SESSION_ID_PATTERN.test(sessionID)) {
      throw new AppError("INVALID_SESSION_ID", "Invalid session id.", 400);
    }

    const directory = await deps.resolveDirectory(c.req.query("directory"));
    const requestId = c.get("requestId");

    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    c.header("Connection", "keep-alive");

    return streamSSE(
      c,
      async (stream) => {
        const controller = new AbortController();
        let closed = false;

        const close = (): void => {
          if (closed) {
            return;
          }
          closed = true;
          controller.abort();
        };

        stream.onAbort(close);
        const remove = deps.sseHub.add(close);

        const heartbeat =
          deps.sseHeartbeatMs > 0
            ? setInterval(() => {
                if (controller.signal.aborted) {
                  return;
                }
                void stream.write(": heartbeat\n\n").catch(close);
              }, deps.sseHeartbeatMs)
            : undefined;
        heartbeat?.unref();

        try {
          for await (const event of deps.gateway.subscribeEvents({
            signal: controller.signal,
            ...(directory !== undefined ? { directory } : {}),
          })) {
            if (sessionID !== undefined && eventSessionId(event) !== sessionID) {
              continue;
            }
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            deps.logger.warn("event stream failed", {
              requestId,
              error,
            });
            try {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  error: {
                    code: "OPENCODE_EVENT_STREAM_FAILED",
                    message: "OpenCode event stream ended.",
                    requestId,
                  },
                }),
              });
            } catch {
              // The client disconnected while we were reporting the error.
            }
          }
        } finally {
          if (heartbeat !== undefined) {
            clearInterval(heartbeat);
          }
          remove();
          close();
        }
      },
      async (error) => {
        deps.logger.debug("sse write failed", {
          requestId,
          error,
        });
      },
    );
  });

  return app;
}
