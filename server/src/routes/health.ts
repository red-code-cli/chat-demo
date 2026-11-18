import { Hono } from "hono";
import { SDK_VERSION, SERVER_VERSION } from "../version.js";
import type { OpencodeGateway } from "../opencode/types.js";
import type { AppBindings } from "../types.js";

export function healthRoute(gateway: OpencodeGateway): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/health", async (c) => {
    const opencode = await gateway.health();
    return c.json(
      {
        status: opencode.healthy ? "ok" : "degraded",
        service: "redcode-server",
        version: SERVER_VERSION,
        sdkVersion: SDK_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        opencode: {
          mode: opencode.mode,
          healthy: opencode.healthy,
          ...(opencode.message !== undefined ? { message: opencode.message } : {}),
        },
      },
      opencode.healthy ? 200 : 503,
    );
  });

  return app;
}
