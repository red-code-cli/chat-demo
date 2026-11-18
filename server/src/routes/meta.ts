import { Hono } from "hono";
import { OPENCODE_CLI_VERSION, SDK_VERSION, SERVER_VERSION } from "../version.js";
import type { AppBindings } from "../types.js";
import type { RouteDependencies } from "./deps.js";

export function metaRoute(deps: RouteDependencies): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/meta", async (c) => {
    const providers = await deps.gateway.listProviders();
    return c.json({
      server: {
        name: "@redcode/server",
        version: SERVER_VERSION,
      },
      sdk: {
        name: "@opencode-ai/sdk",
        version: SDK_VERSION,
      },
      opencode: {
        mode: deps.gateway.mode,
        cliVersion: OPENCODE_CLI_VERSION,
        model: deps.config.opencodeModel ?? null,
      },
      providers,
    });
  });

  return app;
}
