import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencodeServer } from "@opencode-ai/sdk";
import type { OpencodeMode, ServerConfig } from "../config.js";
import { GatewayError } from "../errors.js";
import type { Logger } from "../logger.js";
import { SdkOpencodeGateway } from "./base.js";
import { buildInlineConfig } from "./inline-config.js";
import { assertSdkOk } from "./sdk.js";
import type { GatewayHealth } from "./types.js";

export class EmbeddedOpencodeGateway extends SdkOpencodeGateway {
  readonly mode: OpencodeMode = "embedded";

  private readonly password = randomBytes(32).toString("base64url");
  private server?: { url: string; close(): void };
  private monitor?: NodeJS.Timeout;
  private stopping = false;
  private restarting = false;
  private restartAttempted = false;

  constructor(config: ServerConfig, logger: Logger) {
    super(config, logger);
  }

  async start(): Promise<void> {
    if (this.server !== undefined) {
      return;
    }
    this.stopping = false;
    await this.spawn();

    this.monitor = setInterval(() => {
      void this.checkHealthAndMaybeRestart();
    }, 15_000);
    this.monitor.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.monitor !== undefined) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
    this.closeServer();
  }

  async health(): Promise<GatewayHealth> {
    if (this.client === undefined) {
      return {
        mode: "embedded",
        healthy: false,
        message: "OpenCode is not running.",
      };
    }

    try {
      const result = await this.sdk.path.get({ signal: AbortSignal.timeout(5_000) });
      assertSdkOk(result, "health check");
      return { mode: "embedded", healthy: true };
    } catch {
      return {
        mode: "embedded",
        healthy: false,
        message: "OpenCode is not reachable.",
      };
    }
  }

  private async spawn(): Promise<void> {
    const dataRoot = this.config.opencodeDataDir;
    const dataHome = path.join(dataRoot, "data");
    const configHome = path.join(dataRoot, "config");
    const stateHome = path.join(dataRoot, "state");
    for (const directory of [dataHome, configHome, stateHome]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }

    // Never let the embedded server read the user's global OpenCode config or
    // share its database with a v2 CLI on the same machine.
    process.env.XDG_DATA_HOME = dataHome;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_STATE_HOME = stateHome;
    process.env.OPENCODE_SERVER_PASSWORD = this.password;

    ensurePinnedOpencodeOnPath(this.logger);

    const inlineConfig = buildInlineConfig({
      model: this.config.opencodeModel,
      providerApiKey: this.config.opencodeProviderApiKey,
      logLevel: this.config.logLevel,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const port = await findFreePort();
      try {
        const server = await createOpencodeServer({
          hostname: "127.0.0.1",
          port,
          timeout: 20_000,
          config: inlineConfig,
        });
        if (this.stopping) {
          server.close();
          return;
        }
        this.server = server;
        this.setClients(server.url, this.password);
        this.logger.info("embedded opencode started", {
          url: server.url,
          dataRoot,
        });
        return;
      } catch (error) {
        lastError = error;
        this.logger.warn("embedded opencode failed to start", {
          attempt: attempt + 1,
          port,
          error,
        });
      }
    }

    throw new GatewayError(
      "OPENCODE_START_FAILED",
      "Failed to start embedded OpenCode. Run pnpm install so the pinned CLI is available, then check the server logs.",
      503,
      { cause: lastError },
    );
  }

  private closeServer(): void {
    this.server?.close();
    this.server = undefined;
    this.clearClients();
  }

  private async checkHealthAndMaybeRestart(): Promise<void> {
    if (this.stopping || this.restarting || this.server === undefined) {
      return;
    }

    const health = await this.health();
    if (health.healthy) {
      return;
    }

    this.logger.warn("embedded opencode is unhealthy", {
      restartAttempted: this.restartAttempted,
    });

    if (this.restartAttempted) {
      this.logger.error("embedded opencode restart already attempted; manual restart required");
      return;
    }

    this.restartAttempted = true;
    this.restarting = true;
    try {
      this.logger.warn("restarting embedded opencode");
      this.closeServer();
      await this.spawn();
      this.logger.info("embedded opencode restarted");
    } catch (error) {
      this.logger.error("embedded opencode restart failed", { error });
    } finally {
      this.restarting = false;
    }
  }
}

function ensurePinnedOpencodeOnPath(logger: Logger): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "..", "..", "node_modules", ".bin"),
    path.resolve(process.cwd(), "node_modules", ".bin"),
  ];
  const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";

  for (const directory of candidates) {
    if (!existsSync(path.join(directory, executable))) {
      continue;
    }
    const current = process.env.PATH ?? "";
    const entries = current.split(path.delimiter);
    if (!entries.includes(directory)) {
      process.env.PATH = [directory, ...entries].join(path.delimiter);
    }
    logger.debug("using pinned opencode cli", { directory });
    return;
  }

  logger.warn("pinned opencode cli not found; falling back to PATH");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}
