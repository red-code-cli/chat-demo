import type { DirectoryResolver } from "../workspace.js";
import type { ServerConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { OpencodeGateway } from "../opencode/types.js";
import type { SseHub } from "../sse.js";

export interface RouteDependencies {
  config: ServerConfig;
  gateway: OpencodeGateway;
  logger: Logger;
  resolveDirectory: DirectoryResolver;
  sseHub: SseHub;
  sseHeartbeatMs: number;
}
