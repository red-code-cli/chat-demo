import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createGateway } from "./opencode/factory.js";
import { OPENCODE_CLI_VERSION, SDK_VERSION } from "./version.js";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.error(`[redcode-server] could not load ${envPath}: ${String(error)}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  const gateway = createGateway(config, logger);

  await gateway.start();

  const { app, sseHub } = createApp({ config, gateway, logger });
  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    },
    (info) => {
      logger.info("server listening", {
        host: info.address,
        port: info.port,
        mode: gateway.mode,
        workspaceRoot: config.workspaceRoot,
        model: config.opencodeModel ?? null,
        sdkVersion: SDK_VERSION,
        cliVersion: OPENCODE_CLI_VERSION,
        allowedOrigins: config.allowedOrigins,
      });
    },
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      logger.warn("shutdown already in progress", { signal });
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });

    sseHub.closeAll();

    const force = setTimeout(() => {
      logger.error("forced shutdown after timeout");
      void gateway.stop().finally(() => process.exit(1));
    }, 10_000);
    force.unref();

    server.close((error) => {
      clearTimeout(force);
      void gateway.stop().finally(() => {
        if (error) {
          logger.error("http server close failed", { error });
          process.exit(1);
        }
        logger.info("shutdown complete");
        process.exit(0);
      });
    });
  };

  server.on("error", (error) => {
    logger.error("http server error", { error });
    shutdown("server-error");
  });

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", { error: reason });
  });
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error });
    shutdown("uncaughtException");
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`[redcode-server] ${error.message}`);
  } else {
    console.error(
      `[redcode-server] failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exit(1);
});
