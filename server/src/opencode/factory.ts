import type { ServerConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { EmbeddedOpencodeGateway } from "./embedded.js";
import { RemoteOpencodeGateway } from "./remote.js";
import type { OpencodeGateway } from "./types.js";

export function createGateway(config: ServerConfig, logger: Logger): OpencodeGateway {
  if (config.opencodeMode === "remote") {
    return new RemoteOpencodeGateway(config, logger);
  }
  return new EmbeddedOpencodeGateway(config, logger);
}
