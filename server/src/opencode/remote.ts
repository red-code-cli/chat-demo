import type { OpencodeMode, ServerConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { SdkOpencodeGateway } from "./base.js";
import { assertSdkOk, toGatewayError } from "./sdk.js";
import type { GatewayHealth } from "./types.js";

export class RemoteOpencodeGateway extends SdkOpencodeGateway {
  readonly mode: OpencodeMode = "remote";

  constructor(config: ServerConfig, logger: Logger) {
    super(config, logger);
    if (config.opencodeBaseUrl === undefined) {
      throw new Error("OPENCODE_BASE_URL is required for remote mode");
    }
    this.setClients(config.opencodeBaseUrl, config.opencodeServerPassword);
  }

  async start(): Promise<void> {
    const health = await this.health();
    if (!health.healthy) {
      this.logger.warn("remote opencode is not reachable at startup");
      return;
    }

    try {
      const result = await this.sdk.config.get({ signal: AbortSignal.timeout(5_000) });
      assertSdkOk(result, "read remote config");
      const permission = permissionPolicy(result.data);
      if (!permission.edit || !permission.bash) {
        this.logger.warn("remote opencode permissions are not 'allow'", {
          edit: permission.edit,
          bash: permission.bash,
        });
      }
    } catch (error) {
      this.logger.warn("could not verify remote opencode permissions", {
        error,
      });
    }
  }

  async stop(): Promise<void> {
    this.clearClients();
  }

  async health(): Promise<GatewayHealth> {
    try {
      const result = await this.sdk.path.get({ signal: AbortSignal.timeout(5_000) });
      assertSdkOk(result, "health check");
      return { mode: "remote", healthy: true };
    } catch (error) {
      const gatewayError = toGatewayError(error, "health check");
      return {
        mode: "remote",
        healthy: false,
        message: gatewayError.message,
      };
    }
  }
}

function permissionPolicy(config: unknown): { edit: boolean; bash: boolean } {
  if (!isRecord(config) || !isRecord(config.permission)) {
    return { edit: false, bash: false };
  }

  return {
    edit: isAllow(config.permission.edit),
    bash: isAllow(config.permission.bash),
  };
}

function isAllow(value: unknown): boolean {
  if (value === "allow") {
    return true;
  }
  if (isRecord(value)) {
    const values = Object.values(value);
    return values.length > 0 && values.every((entry) => entry === "allow");
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
